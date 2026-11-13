import fsSync, { promises as fs } from 'node:fs';
import path from 'node:path';

import mime from 'mime-types';

import { getGlobalImageAssetsDir, toPosixPath } from '@/shared/image-attachments.js';
import { decodeMultipartFilename } from '@/shared/utils.js';

/**
 * Byte budget for the sanitized original name inside a stored asset filename.
 * The `<ms>-<random>-` prefix adds at most 25 bytes, which keeps every stored
 * name under the 255-byte limit of ext4 and APFS (NTFS: 255 UTF-16 units) even
 * for scripts that take 2-4 UTF-8 bytes per character.
 */
const MAX_STORED_NAME_BYTES = 200;

// Real extensions are short; a longer tail after the last dot is just part of
// a dotted name, so it is truncated with the rest instead of being preserved.
const MAX_KEPT_EXTENSION_BYTES = 32;

// Truncation walks user-perceived characters so it never splits a surrogate
// pair or separates a letter from its combining marks.
const GRAPHEME_SEGMENTER = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/**
 * Image mime types accepted for chat attachment uploads. SVG is allowed for
 * storage/preview even though some providers (Claude API) skip it at send time.
 */
const ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
]);

// Used only by this service and the assets routes via the barrel file.
type StoredImageAsset = {
  /** Original upload filename, for display. */
  name: string;
  /** Absolute posix-normalized path inside the global assets folder. */
  path: string;
  size: number;
  mimeType: string;
};

// Shape of one multer-stored file; kept local because only this module reads it.
type UploadedImageFile = {
  originalname: string;
  filename: string;
  size: number;
  mimetype: string;
};

type UploadedAttachmentFile = UploadedImageFile;

/** Returns whether one uploaded mime type may be stored as a chat image asset. */
export function isAllowedImageMimeType(mimeType: string): boolean {
  return ALLOWED_IMAGE_MIME_TYPES.has(mimeType);
}

/** Creates the global `~/.cloudcli/assets` folder if needed and returns it. */
export async function ensureImageAssetsDir(): Promise<string> {
  const assetsDir = getGlobalImageAssetsDir();
  await fs.mkdir(assetsDir, { recursive: true });
  return assetsDir;
}

/** Cuts a string to at most `maxBytes` UTF-8 bytes at a character boundary. */
function truncateToUtf8Bytes(value: string, maxBytes: number): string {
  let truncated = '';
  let usedBytes = 0;
  for (const { segment } of GRAPHEME_SEGMENTER.segment(value)) {
    const segmentBytes = Buffer.byteLength(segment);
    if (usedBytes + segmentBytes > maxBytes) {
      break;
    }
    truncated += segment;
    usedBytes += segmentBytes;
  }
  return truncated;
}

/**
 * Turns an uploaded file's name into the readable part of its stored name.
 *
 * Letters, digits and combining marks of every script are kept, so a Cyrillic
 * or CJK name stays recognizable. Everything else (whitespace, punctuation,
 * symbols, emoji, control and bidi characters, path separators) becomes `_`:
 * the stored path is listed unquoted in agent prompts (see
 * `appendFilesInputTag`), where whitespace would split it and shell syntax
 * must never appear.
 */
function sanitizeStoredAssetName(originalName: string): string {
  const safeName = decodeMultipartFilename(originalName)
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}\p{M}._-]/gu, '_');

  let cappedName = safeName;
  if (Buffer.byteLength(safeName) > MAX_STORED_NAME_BYTES) {
    const extension = path.extname(safeName);
    const keptExtension = Buffer.byteLength(extension) <= MAX_KEPT_EXTENSION_BYTES ? extension : '';
    const baseName = safeName.slice(0, safeName.length - keptExtension.length);
    cappedName = truncateToUtf8Bytes(baseName, MAX_STORED_NAME_BYTES - Buffer.byteLength(keptExtension))
      + keptExtension;
  }

  // The serving routes refuse any name containing `..`; collapsing dot runs
  // last also covers a cut that left the base name ending in a dot.
  return cappedName.replace(/\.{2,}/g, '.');
}

/**
 * Builds the unique on-disk filename for one chat upload from the name the
 * client sent: a `<ms>-<random>-` prefix plus the sanitized, length-capped
 * original name with its extension. The assets routes use it as multer's
 * `filename` callback; the readable original name is returned separately by
 * `buildStoredImageRecords`.
 */
export function buildStoredAssetFileName(originalName: string): string {
  const uniquePrefix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
  return `${uniquePrefix}-${sanitizeStoredAssetName(originalName)}`;
}

/**
 * Maps multer-stored upload files to the attachment records returned to the
 * chat composer. The absolute path is what providers receive and what session
 * history carries back to the UI; `name` is the original filename, decoded
 * from the raw UTF-8 bytes browsers send.
 */
export function buildStoredImageRecords(files: UploadedImageFile[]): StoredImageAsset[] {
  const assetsDir = getGlobalImageAssetsDir();
  return files.map((file) => ({
    name: decodeMultipartFilename(file.originalname),
    path: toPosixPath(path.join(assetsDir, file.filename)),
    size: file.size,
    mimeType: file.mimetype,
  }));
}

/**
 * Maps multer-stored files to provider-neutral attachment records for the
 * assets route. The shared storage format intentionally matches image records
 * so one uploaded file can move through queueing and provider dispatch.
 */
export function buildStoredAttachmentRecords(files: UploadedAttachmentFile[]): StoredImageAsset[] {
  return buildStoredImageRecords(files);
}

/**
 * Resolves one asset filename to its absolute path inside the global assets
 * folder, or null when the name is empty, contains path separators/traversal,
 * or would escape the folder. This is the only lookup the serving route uses,
 * so nothing outside `~/.cloudcli/assets` can ever be read through it.
 */
export function resolveImageAssetFile(filename: string): string | null {
  const trimmed = typeof filename === 'string' ? filename.trim() : '';
  if (!trimmed || trimmed.includes('/') || trimmed.includes('\\') || trimmed.includes('..')) {
    return null;
  }

  const assetsDir = path.resolve(getGlobalImageAssetsDir());
  const resolved = path.resolve(assetsDir, trimmed);
  if (!resolved.startsWith(assetsDir + path.sep)) {
    return null;
  }

  return resolved;
}

/**
 * Resolves a general chat attachment for the assets serving route. It shares
 * the image resolver's strict direct-child containment boundary.
 */
export function resolveAttachmentAssetFile(filename: string): string | null {
  return resolveImageAssetFile(filename);
}

/**
 * Opens one stored chat asset for the assets route without exposing arbitrary
 * filesystem reads. The route translates the lookup status and streams the
 * returned direct-child file to the authenticated client.
 */
export async function openStoredAttachmentAsset(filename: string) {
  const resolved = resolveAttachmentAssetFile(filename);
  if (!resolved) {
    return { status: 'invalid' as const };
  }

  try {
    await fs.access(resolved);
  } catch {
    return { status: 'missing' as const };
  }

  return {
    status: 'found' as const,
    contentType: mime.lookup(resolved) || 'application/octet-stream',
    stream: fsSync.createReadStream(resolved),
  };
}
