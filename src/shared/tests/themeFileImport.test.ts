import assert from 'node:assert/strict';

import { test } from 'vitest';

import { importThemesFromFile } from '@/shared/themes';
import { MAX_THEME_SOURCE_BYTES, VsCodeThemeImportError } from '@/shared/themes/vscodeThemeImport';
import { MAX_VSIX_BYTES } from '@/shared/themes/vsixThemeImport';

/**
 * The size limits live in the parsers, but a parser only sees the bytes once the
 * whole file has been read into memory. These cover the picker's own preflight,
 * so `arrayBuffer`/`text` throw if the limit failed to short-circuit.
 */
const unreadableFile = (name: string, signature: number[], size: number): File => ({
  name,
  size,
  slice: () => ({ arrayBuffer: async () => new Uint8Array(signature).buffer }),
  arrayBuffer: () => assert.fail('the whole file was read past the size check'),
  text: () => assert.fail('the whole file was read past the size check'),
}) as unknown as File;

// jsdom ships a Blob without the reader methods every browser has had since 2019.
const readBlob = <T>(blob: Blob, as: 'arraybuffer' | 'text'): Promise<T> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as T);
    reader.onerror = () => reject(reader.error);
    if (as === 'arraybuffer') reader.readAsArrayBuffer(blob);
    else reader.readAsText(blob);
  });

Blob.prototype.arrayBuffer ??= function arrayBuffer(this: Blob) {
  return readBlob<ArrayBuffer>(this, 'arraybuffer');
};
Blob.prototype.text ??= function text(this: Blob) {
  return readBlob<string>(this, 'text');
};

const ZIP_SIGNATURE = [0x50, 0x4b];
const JSON_SIGNATURE = [0x7b, 0x22];

test('a .vsix past the size limit is refused before it is read', async () => {
  await assert.rejects(
    importThemesFromFile(unreadableFile('big.vsix', ZIP_SIGNATURE, MAX_VSIX_BYTES + 1)),
    (error: Error) => error instanceof VsCodeThemeImportError && error.message.includes('too large'),
  );
});

test('a theme json past the size limit is refused before it is read', async () => {
  await assert.rejects(
    importThemesFromFile(unreadableFile('big-color-theme.json', JSON_SIGNATURE, MAX_THEME_SOURCE_BYTES + 1)),
    (error: Error) => error instanceof VsCodeThemeImportError && error.message.includes('too large'),
  );
});

test('a theme inside the limit still imports, and takes its name from the file', async () => {
  const source = JSON.stringify({
    type: 'dark',
    colors: { 'editor.background': '#1e1e1e', 'editor.foreground': '#d4d4d4' },
  });
  const file = new File([source], 'Night Owl-color-theme.json', { type: 'application/json' });

  const [theme] = await importThemesFromFile(file);

  assert.equal(theme.name, 'Night Owl');
  assert.equal(theme.appearance, 'dark');
});
