import assert from 'node:assert/strict';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  appendImagesInputTag,
  buildClaudeUserContent,
  buildCodexInputItems,
  isAllowedImageSourcePath,
  normalizeImageDescriptors,
  parseImagesInputTag,
  resolveImageMediaType,
  toImageAttachments,
} from '@/shared/image-attachments.js';

// 1x1 transparent PNG
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

const SYMLINK_UNSUPPORTED_CODES = new Set(['EACCES', 'EINVAL', 'ENOSYS', 'ENOTSUP', 'EPERM']);

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

async function createSymlinkIfSupported(
  target: string,
  linkPath: string,
  type: 'dir' | 'file' | 'junction',
): Promise<boolean> {
  try {
    await symlink(target, linkPath, type);
    return true;
  } catch (error) {
    if (
      isErrnoException(error) &&
      typeof error.code === 'string' &&
      SYMLINK_UNSUPPORTED_CODES.has(error.code)
    ) {
      return false;
    }
    throw error;
  }
}

test('normalizeImageDescriptors accepts objects and bare paths, drops junk', () => {
  const descriptors = normalizeImageDescriptors([
    { path: '.cloudcli/assets/a.png', name: 'a.png', mimeType: 'image/png' },
    'scripts/pic.jpg',
    { name: 'no-path.png' },
    42,
    null,
    '',
  ]);

  assert.deepEqual(descriptors, [
    { path: '.cloudcli/assets/a.png', name: 'a.png', mimeType: 'image/png' },
    { path: 'scripts/pic.jpg' },
  ]);
  assert.deepEqual(normalizeImageDescriptors(undefined), []);
  assert.deepEqual(normalizeImageDescriptors('not-an-array'), []);
});

test('appendImagesInputTag and parseImagesInputTag round-trip', () => {
  const prompt = 'Describe these screenshots.\n\nFocus on the header.';
  const tagged = appendImagesInputTag(prompt, [
    { path: '.cloudcli/assets/1-a.png' },
    { path: '.cloudcli\\assets\\2-b.jpg' },
  ]);

  assert.ok(tagged.startsWith(prompt));
  assert.ok(tagged.includes('<images_input>'));
  assert.ok(tagged.includes('</images_input>'));
  assert.ok(tagged.includes('The user attached 2 image(s)'));

  const parsed = parseImagesInputTag(tagged);
  assert.equal(parsed.text, prompt);
  // Backslashes are normalized so references stay portable.
  assert.deepEqual(parsed.imagePaths, ['.cloudcli/assets/1-a.png', '.cloudcli/assets/2-b.jpg']);
});

test('original filenames round-trip through the tag', () => {
  const tagged = appendImagesInputTag('compare these', [
    { path: 'C:/Users/x/.cloudcli/assets/1-a.png', name: 'screenshot (final).png' },
    { path: 'C:/Users/x/.cloudcli/assets/2-b.jpg' },
  ]);

  const parsed = parseImagesInputTag(tagged);
  assert.equal(parsed.text, 'compare these');
  // Parentheses are dropped from names so the "(original name: ...)" suffix
  // stays parseable; the path-only entry carries no name.
  assert.deepEqual(parsed.attachments, [
    { path: 'C:/Users/x/.cloudcli/assets/1-a.png', name: 'screenshot final.png' },
    { path: 'C:/Users/x/.cloudcli/assets/2-b.jpg' },
  ]);
});

test('only the LAST images_input block is treated as the attachment carrier', () => {
  const userTypedTag = 'What does <images_input> mean in this codebase?';
  const tagged = appendImagesInputTag(
    `${userTypedTag}\n\n<images_input>\nfake user block\n</images_input>\n\nAlso check this.`,
    [{ path: 'C:/Users/x/.cloudcli/assets/real.png' }],
  );

  const parsed = parseImagesInputTag(tagged);
  assert.ok(parsed.text.includes('fake user block'));
  assert.ok(parsed.text.includes('Also check this.'));
  assert.deepEqual(parsed.imagePaths, ['C:/Users/x/.cloudcli/assets/real.png']);
});

test('appendImagesInputTag without images returns the prompt untouched', () => {
  assert.equal(appendImagesInputTag('hello', []), 'hello');
  assert.equal(appendImagesInputTag('hello', undefined), 'hello');
});

test('parseImagesInputTag handles prompts flattened to one line for cmd.exe shims', () => {
  // Windows spawn runtimes collapse newlines before passing the argument to
  // .cmd-shimmed CLIs; the persisted prompt is then a single line.
  const flattened = appendImagesInputTag('now?', [{ path: 'C:/Users/x/.cloudcli/assets/a.jpg' }])
    .replace(/\s*\r?\n\s*/g, ' ')
    .trim();

  assert.ok(!flattened.includes('\n'));
  const parsed = parseImagesInputTag(flattened);
  assert.equal(parsed.text, 'now?');
  assert.deepEqual(parsed.imagePaths, ['C:/Users/x/.cloudcli/assets/a.jpg']);
});

test('parseImagesInputTag leaves text without a tag untouched', () => {
  const text = 'Just a normal prompt with [brackets] and JSON ["like"] content.';
  const parsed = parseImagesInputTag(text);
  assert.equal(parsed.text, text);
  assert.deepEqual(parsed.imagePaths, []);
});

test('parseImagesInputTag strips a malformed tag body without attaching images', () => {
  const text = 'prompt\n\n<images_input>\nnot json here\n</images_input>';
  const parsed = parseImagesInputTag(text);
  assert.equal(parsed.text, 'prompt');
  assert.deepEqual(parsed.imagePaths, []);
});

test('toImageAttachments maps paths to posix attachment records', () => {
  assert.deepEqual(toImageAttachments(['a\\b\\c.png', 'd/e.jpg']), [
    { path: 'a/b/c.png' },
    { path: 'd/e.jpg' },
  ]);
});

test('resolveImageMediaType prefers the mime type and falls back to the extension', () => {
  assert.equal(resolveImageMediaType({ path: 'x.bin', mimeType: 'image/webp' }), 'image/webp');
  assert.equal(resolveImageMediaType({ path: 'x.JPG' }), 'image/jpeg');
  assert.equal(resolveImageMediaType({ path: 'x.png' }), 'image/png');
  assert.equal(resolveImageMediaType({ path: 'x.unknown' }), null);
});

test('buildClaudeUserContent reads image bytes into base64 blocks', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'image-attachments-'));
  try {
    await writeFile(path.join(tempDir, 'shot.png'), PNG_BYTES);

    const content = await buildClaudeUserContent(
      'What is in this image?',
      [{ path: 'shot.png', mimeType: 'image/png' }],
      tempDir,
    );

    assert.equal(content.length, 2);
    assert.deepEqual(content[0], { type: 'text', text: 'What is in this image?' });
    assert.equal(content[1].type, 'image');
    const imageBlock = content[1] as Extract<(typeof content)[number], { type: 'image' }>;
    assert.equal(imageBlock.source.type, 'base64');
    assert.equal(imageBlock.source.media_type, 'image/png');
    assert.equal(imageBlock.source.data, PNG_BYTES.toString('base64'));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('buildClaudeUserContent skips unsupported types and unreadable files', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'image-attachments-'));
  try {
    await writeFile(path.join(tempDir, 'vector.svg'), '<svg></svg>');

    const content = await buildClaudeUserContent(
      'prompt',
      [
        { path: 'vector.svg', mimeType: 'image/svg+xml' },
        { path: 'missing.png', mimeType: 'image/png' },
      ],
      tempDir,
    );

    // Only the text block survives; the prompt still goes through.
    assert.deepEqual(content, [{ type: 'text', text: 'prompt' }]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('buildClaudeUserContent refuses symlinked images outside allowed roots', async (t) => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'image-attachments-'));
  const outsideDir = await mkdtemp(path.join(os.tmpdir(), 'image-attachments-outside-'));
  try {
    const outsideFile = path.join(outsideDir, 'secret.png');
    await writeFile(outsideFile, PNG_BYTES);

    const linkPath = path.join(tempDir, 'linked-secret.png');
    if (!(await createSymlinkIfSupported(outsideFile, linkPath, 'file'))) {
      t.skip('Symlink creation is not supported in this environment');
      return;
    }

    const content = await buildClaudeUserContent(
      'prompt',
      [{ path: 'linked-secret.png', mimeType: 'image/png' }],
      tempDir,
    );

    assert.deepEqual(content, [{ type: 'text', text: 'prompt' }]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
    await rm(outsideDir, { recursive: true, force: true });
  }
});

test('buildClaudeUserContent accepts images under a symlinked cwd', async (t) => {
  const realProjectDir = await mkdtemp(path.join(os.tmpdir(), 'image-attachments-project-'));
  const linkParentDir = await mkdtemp(path.join(os.tmpdir(), 'image-attachments-link-'));
  try {
    await writeFile(path.join(realProjectDir, 'shot.png'), PNG_BYTES);

    const linkCwd = path.join(linkParentDir, 'project-link');
    const linkType = process.platform === 'win32' ? 'junction' : 'dir';
    if (!(await createSymlinkIfSupported(realProjectDir, linkCwd, linkType))) {
      t.skip('Symlink creation is not supported in this environment');
      return;
    }

    const content = await buildClaudeUserContent(
      'prompt',
      [{ path: 'shot.png', mimeType: 'image/png' }],
      linkCwd,
    );

    assert.equal(content.length, 2);
    assert.equal(content[1].type, 'image');
    const imageBlock = content[1] as Extract<(typeof content)[number], { type: 'image' }>;
    assert.equal(imageBlock.source.data, PNG_BYTES.toString('base64'));
  } finally {
    await rm(linkParentDir, { recursive: true, force: true });
    await rm(realProjectDir, { recursive: true, force: true });
  }
});

test('buildCodexInputItems emits text plus absolute local_image paths', () => {
  const cwd = path.join(os.tmpdir(), 'codex-project');
  const items = buildCodexInputItems('Describe this image:', [{ path: '.cloudcli/assets/pic.jpg' }], cwd);

  assert.equal(items.length, 2);
  assert.deepEqual(items[0], { type: 'text', text: 'Describe this image:' });
  assert.equal(items[1].type, 'local_image');
  const imageItem = items[1] as Extract<(typeof items)[number], { type: 'local_image' }>;
  assert.ok(path.isAbsolute(imageItem.path));
  assert.equal(imageItem.path, path.resolve(cwd, '.cloudcli/assets/pic.jpg'));
});

test('isAllowedImageSourcePath only accepts the upload store and the run cwd', () => {
  const cwd = path.join(os.tmpdir(), 'some-project');
  const uploadStore = path.join(os.homedir(), '.cloudcli', 'assets');

  assert.equal(isAllowedImageSourcePath(path.join(uploadStore, 'shot.png'), cwd), true);
  assert.equal(isAllowedImageSourcePath(path.join(cwd, 'docs', 'diagram.png'), cwd), true);

  assert.equal(isAllowedImageSourcePath(path.join(os.homedir(), '.ssh', 'id_rsa'), cwd), false);
  assert.equal(isAllowedImageSourcePath(path.join(cwd, '..', 'other-project', 'x.png'), cwd), false);
  // The roots themselves are directories, not readable image files.
  assert.equal(isAllowedImageSourcePath(cwd, cwd), false);
});

test('provider builders refuse descriptors outside the allowed roots', async () => {
  const cwd = path.join(os.tmpdir(), 'codex-project');
  const outsidePath = path.join(os.homedir(), '.ssh', 'id_rsa.png');

  const codexItems = buildCodexInputItems('prompt', [{ path: outsidePath }], cwd);
  assert.deepEqual(codexItems, [{ type: 'text', text: 'prompt' }]);

  const claudeContent = await buildClaudeUserContent(
    'prompt',
    [{ path: outsidePath, mimeType: 'image/png' }],
    cwd,
  );
  assert.deepEqual(claudeContent, [{ type: 'text', text: 'prompt' }]);
});
