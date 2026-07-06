import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Shared image-attachment plumbing for every provider runtime.
 *
 * Uploaded chat images are persisted once in the global `~/.cloudcli/assets`
 * folder and referenced by absolute path everywhere else:
 * - Claude: paths are read back into base64 `image` content blocks.
 * - Codex: paths become `local_image` input items.
 * - Cursor/OpenCode: paths are appended to the prompt inside an
 *   `<images_input>` tag, which is stripped again when history is read.
 *
 * The chat UI loads them through the dedicated `/api/assets/images/:filename`
 * route, which serves only from this folder.
 */

/** Global storage folder for uploaded chat image attachments. */
export function getGlobalImageAssetsDir(): string {
  return path.join(os.homedir(), '.cloudcli', 'assets');
}

export type ImageAttachmentDescriptor = {
  /** Project-relative (preferred) or absolute path to the stored image. */
  path: string;
  name?: string;
  mimeType?: string;
};

/** Media types the Claude Messages API accepts for base64 image blocks. */
const CLAUDE_IMAGE_MEDIA_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);

const EXTENSION_TO_MEDIA_TYPE: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

/**
 * Accepts the loosely-typed `options.images` payload from chat.send and
 * returns only well-formed descriptors. Plain path strings are supported so
 * callers can also pass bare path arrays.
 */
export function normalizeImageDescriptors(images: unknown): ImageAttachmentDescriptor[] {
  if (!Array.isArray(images)) {
    return [];
  }

  const descriptors: ImageAttachmentDescriptor[] = [];
  for (const entry of images) {
    if (typeof entry === 'string' && entry.trim()) {
      descriptors.push({ path: entry.trim() });
      continue;
    }
    if (entry && typeof entry === 'object') {
      const record = entry as Record<string, unknown>;
      const entryPath = typeof record.path === 'string' ? record.path.trim() : '';
      if (!entryPath) {
        continue;
      }
      descriptors.push({
        path: entryPath,
        name: typeof record.name === 'string' ? record.name : undefined,
        mimeType: typeof record.mimeType === 'string' ? record.mimeType : undefined,
      });
    }
  }
  return descriptors;
}

/** Normalizes Windows separators so stored references stay portable. */
export function toPosixPath(value: string): string {
  return value.replace(/\\/g, '/');
}

/** Resolves a project-relative image path against the run's working directory. */
export function resolveImageAbsolutePath(cwd: string | undefined, imagePath: string): string {
  if (path.isAbsolute(imagePath)) {
    return imagePath;
  }
  return path.resolve(cwd || process.cwd(), imagePath);
}

function isPathInsideDirectory(candidate: string, directory: string): boolean {
  const relative = path.relative(path.resolve(directory), candidate);
  return relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative);
}

/**
 * Second layer of the image trust boundary (the first is the chat.send filter
 * in the websocket gateway): provider builders only reference files that live
 * in the global upload store or inside the run's working directory — places
 * the agent could already access on its own. Anything else (e.g. `~/.ssh`) is
 * refused, so a caller-supplied descriptor can never leak arbitrary files.
 */
export function isAllowedImageSourcePath(resolvedPath: string, cwd?: string): boolean {
  return (
    isPathInsideDirectory(resolvedPath, getGlobalImageAssetsDir()) ||
    isPathInsideDirectory(resolvedPath, cwd || process.cwd())
  );
}

/**
 * Resolves the media type for one image, preferring the uploaded mime type and
 * falling back to the file extension.
 */
export function resolveImageMediaType(descriptor: ImageAttachmentDescriptor): string | null {
  if (descriptor.mimeType) {
    return descriptor.mimeType;
  }
  const extension = path.extname(descriptor.path).toLowerCase();
  return EXTENSION_TO_MEDIA_TYPE[extension] || null;
}

const IMAGES_INPUT_TAG_PATTERN = /\s*<images_input>([\s\S]*?)<\/images_input>\s*/g;

// One image reference recovered from an <images_input> block: the stored
// asset path plus the user's original filename when it was recorded.
export type ParsedImageAttachment = {
  path: string;
  name?: string;
};

// Result of stripping an <images_input> block out of persisted prompt text.
// `imagePaths` mirrors `attachments` for callers that only need paths.
export type ParsedImagesInput = {
  text: string;
  imagePaths: string[];
  attachments: ParsedImageAttachment[];
};

/**
 * Appends the `<images_input>` reference block used by the Cursor and
 * OpenCode CLIs. The block carries one numbered line per attachment with
 * the stored file path (quote-free on purpose — Windows .cmd shims mangle
 * quoted text) and the user's original filename, plus an explicit instruction
 * to read the files and keep the block out of the reply. The same block is
 * stripped back out of persisted history by {@link parseImagesInputTag}.
 */
export function appendImagesInputTag(prompt: string, images: unknown): string {
  const descriptors = normalizeImageDescriptors(images);
  if (descriptors.length === 0) {
    return prompt;
  }

  const entryLines = descriptors.map((descriptor, index) => {
    const entryPath = toPosixPath(descriptor.path);
    // Parentheses and newlines would break the "(original name: ...)" suffix
    // the parser looks for, so drop them from the display name.
    const cleanName = descriptor.name?.replace(/[()\r\n]/g, '').trim();
    return cleanName
      ? `${index + 1}. ${entryPath} (original name: ${cleanName})`
      : `${index + 1}. ${entryPath}`;
  });

  return [
    prompt,
    '',
    '<images_input>',
    `The user attached ${descriptors.length} image(s) to this message. Read each file listed below with your file/image reading tool and use what you see to answer the prompt above. Respond as if the images were attached directly. Do not mention this block or the file paths unless the user asks about them.`,
    ...entryLines,
    '</images_input>',
  ].join('\n');
}

// Matches one numbered attachment entry inside the tag body. Works for both
// the multi-line block and the Windows-flattened single-line form, where the
// next ` N. ` marker (or the end of the body) delimits each entry.
const IMAGES_INPUT_ENTRY_PATTERN = /\d+\.\s+(.+?)(?=\s+\d+\.\s+|\s*$)/g;

const ORIGINAL_NAME_SUFFIX_PATTERN = /\(original name: ([^)]*)\)\s*$/;

function parseNumberedImageEntries(inner: string): ParsedImageAttachment[] {
  const attachments: ParsedImageAttachment[] = [];
  for (const entryMatch of inner.matchAll(IMAGES_INPUT_ENTRY_PATTERN)) {
    let entryText = entryMatch[1].trim();
    let name: string | undefined;

    const nameMatch = ORIGINAL_NAME_SUFFIX_PATTERN.exec(entryText);
    if (nameMatch) {
      name = nameMatch[1].trim() || undefined;
      entryText = entryText.slice(0, nameMatch.index).trim();
    }

    if (entryText) {
      attachments.push(name ? { path: toPosixPath(entryText), name } : { path: toPosixPath(entryText) });
    }
  }
  return attachments;
}

/**
 * Strips one `<images_input>` block from persisted prompt text and returns
 * the clean text plus the referenced attachments (path and original name).
 *
 * Only the LAST block in the text is treated as the attachment carrier — the
 * composer always appends it at the end, so a user who literally typed
 * `<images_input>` earlier in their prompt keeps that text intact.
 *
 * Understands the numbered-line body in both its multi-line and
 * Windows-flattened single-line forms.
 */
export function parseImagesInputTag(text: string): ParsedImagesInput {
  if (typeof text !== 'string' || !text.includes('<images_input>')) {
    return { text, imagePaths: [], attachments: [] };
  }

  let lastMatch: RegExpExecArray | null = null;
  IMAGES_INPUT_TAG_PATTERN.lastIndex = 0;
  for (let match = IMAGES_INPUT_TAG_PATTERN.exec(text); match; match = IMAGES_INPUT_TAG_PATTERN.exec(text)) {
    lastMatch = match;
  }
  if (!lastMatch) {
    return { text, imagePaths: [], attachments: [] };
  }

  const attachments = parseNumberedImageEntries(lastMatch[1]);

  const stripped = (
    text.slice(0, lastMatch.index) + '\n' + text.slice(lastMatch.index + lastMatch[0].length)
  ).trim();

  return {
    text: stripped,
    imagePaths: attachments.map((attachment) => attachment.path),
    attachments,
  };
}

/** Maps raw image paths to the attachment shape carried by NormalizedMessage.images. */
export function toImageAttachments(imagePaths: string[]): Array<{ path: string }> {
  return imagePaths.map((imagePath) => ({ path: toPosixPath(imagePath) }));
}

type ClaudeContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } };

/**
 * Builds the Claude user-message content list: the prompt text followed by one
 * base64 `image` block per attachment. Images the Claude API cannot accept
 * (e.g. SVG) or that fail to read are skipped with a warning so the prompt
 * itself still goes through.
 */
export async function buildClaudeUserContent(
  prompt: string,
  images: unknown,
  cwd?: string,
): Promise<ClaudeContentBlock[]> {
  const blocks: ClaudeContentBlock[] = [{ type: 'text', text: prompt }];

  for (const descriptor of normalizeImageDescriptors(images)) {
    const mediaType = resolveImageMediaType(descriptor);
    if (!mediaType || !CLAUDE_IMAGE_MEDIA_TYPES.has(mediaType)) {
      console.warn(`[Images] Skipping unsupported Claude image type for ${descriptor.path}`);
      continue;
    }

    const resolvedPath = resolveImageAbsolutePath(cwd, descriptor.path);
    if (!isAllowedImageSourcePath(resolvedPath, cwd)) {
      console.warn(`[Images] Refusing to read image outside allowed roots: ${descriptor.path}`);
      continue;
    }

    try {
      const bytes = await fs.readFile(resolvedPath);
      blocks.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: mediaType,
          data: bytes.toString('base64'),
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[Images] Failed to read image ${descriptor.path}: ${message}`);
    }
  }

  return blocks;
}

type CodexInputItem =
  | { type: 'text'; text: string }
  | { type: 'local_image'; path: string };

/**
 * Builds the Codex `runStreamed` input list: prompt text plus one
 * `local_image` item per attachment, resolved to absolute paths so the Codex
 * runtime can read them regardless of its own working directory handling.
 */
export function buildCodexInputItems(prompt: string, images: unknown, cwd?: string): CodexInputItem[] {
  const items: CodexInputItem[] = [{ type: 'text', text: prompt }];
  for (const descriptor of normalizeImageDescriptors(images)) {
    const resolvedPath = resolveImageAbsolutePath(cwd, descriptor.path);
    if (!isAllowedImageSourcePath(resolvedPath, cwd)) {
      // Same trust boundary as buildClaudeUserContent — the Codex runtime
      // reads this file, so it must stay within the allowed roots.
      console.warn(`[Images] Refusing to attach image outside allowed roots: ${descriptor.path}`);
      continue;
    }
    items.push({
      type: 'local_image',
      path: resolvedPath,
    });
  }
  return items;
}
