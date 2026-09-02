import assert from 'node:assert/strict';

import JSZip from 'jszip';
import { test } from 'vitest';

import { VsCodeThemeImportError } from '@/shared/themes/vscodeThemeImport';
import { parseVsixThemes } from '@/shared/themes/vsixThemeImport';

/**
 * A `.vsix` is the shape themes are actually published in, and the only shape
 * whose `include` chains can be resolved: the base file a theme extends lives
 * inside the same archive and nowhere else.
 */

const buildVsix = async (files: Record<string, string>): Promise<ArrayBuffer> => {
  const archive = new JSZip();
  for (const [path, content] of Object.entries(files)) {
    archive.file(path, content);
  }
  return archive.generateAsync({ type: 'arraybuffer' });
};

const manifest = (themes: unknown[]) => JSON.stringify({
  name: 'test-extension',
  contributes: { themes },
});

const themeFile = (colors: Record<string, string>, extra: Record<string, unknown> = {}) => JSON.stringify({
  ...extra,
  colors: { 'editor.background': '#1e1e2e', 'editor.foreground': '#cdd6f4', ...colors },
});

test('imports every theme an extension contributes', async () => {
  const data = await buildVsix({
    'extension/package.json': manifest([
      { label: 'Mocha', uiTheme: 'vs-dark', path: './themes/mocha.json' },
      { label: 'Latte', uiTheme: 'vs', path: './themes/latte.json' },
    ]),
    'extension/themes/mocha.json': themeFile({}),
    'extension/themes/latte.json': themeFile({ 'editor.background': '#eff1f5', 'editor.foreground': '#4c4f69' }),
  });

  const themes = await parseVsixThemes(data, 'fallback');

  assert.equal(themes.length, 2);
  assert.deepEqual(themes.map((theme) => theme.name), ['Mocha', 'Latte']);
  assert.deepEqual(themes.map((theme) => theme.appearance), ['dark', 'light']);
});

test('labels each variant from the manifest, not from the theme file', async () => {
  // One Dark Pro's shape: every variant file names itself identically, and only
  // the manifest distinguishes them.
  const data = await buildVsix({
    'extension/package.json': manifest([
      { label: 'One Dark Pro', path: './a.json' },
      { label: 'One Dark Pro Flat', path: './b.json' },
    ]),
    'extension/a.json': themeFile({}, { name: 'One Dark Pro' }),
    'extension/b.json': themeFile({}, { name: 'One Dark Pro' }),
  });

  const themes = await parseVsixThemes(data, 'fallback');

  assert.deepEqual(themes.map((theme) => theme.name), ['One Dark Pro', 'One Dark Pro Flat']);
});

test('resolves an include chain inside the archive', async () => {
  const data = await buildVsix({
    'extension/package.json': manifest([{ label: 'Child', path: './themes/child.json' }]),
    'extension/themes/base.json': themeFile({ 'activityBarBadge.background': '#000000' }, { type: 'dark' }),
    'extension/themes/child.json': JSON.stringify({
      include: './base.json',
      colors: { 'activityBarBadge.background': '#cba6f7' },
    }),
  });

  const themes = await parseVsixThemes(data, 'fallback');

  // The base supplies the editor colours; the including file wins on the accent.
  assert.equal(themes[0].tokens?.background, '240 21.05% 14.9%');
  assert.equal(themes[0].tokens?.primary, '267.41 83.51% 80.98%');
  assert.equal(themes[0].appearance, 'dark', 'the type comes from the included base');
});

test('falls back to the manifest uiTheme when the theme file omits its type', async () => {
  const data = await buildVsix({
    'extension/package.json': manifest([{ label: 'Bright', uiTheme: 'vs', path: './theme.json' }]),
    // A near-black background that luminance alone would classify as dark.
    'extension/theme.json': themeFile({ 'editor.background': '#101010', 'editor.foreground': '#eeeeee' }),
  });

  const themes = await parseVsixThemes(data, 'fallback');

  assert.equal(themes[0].appearance, 'light');
});

test('keeps the variants that work when one is broken', async () => {
  const data = await buildVsix({
    'extension/package.json': manifest([
      { label: 'Missing', path: './themes/gone.json' },
      { label: 'Fine', path: './themes/fine.json' },
    ]),
    'extension/themes/fine.json': themeFile({}),
  });

  const themes = await parseVsixThemes(data, 'fallback');

  assert.deepEqual(themes.map((theme) => theme.name), ['Fine']);
});

test('rejects an archive that is not a VS Code extension', async () => {
  const data = await buildVsix({ 'readme.txt': 'nothing to see' });

  await assert.rejects(() => parseVsixThemes(data, 'fallback'), VsCodeThemeImportError);
});

test('rejects an extension that contributes no themes', async () => {
  const data = await buildVsix({
    'extension/package.json': JSON.stringify({ contributes: { commands: [] } }),
  });

  await assert.rejects(() => parseVsixThemes(data, 'fallback'), VsCodeThemeImportError);
});

test('reports why when no contributed theme could be read', async () => {
  const data = await buildVsix({
    'extension/package.json': manifest([{ label: 'Missing', path: './themes/gone.json' }]),
  });

  await assert.rejects(
    () => parseVsixThemes(data, 'fallback'),
    (error: Error) => error instanceof VsCodeThemeImportError && error.message.includes('gone.json'),
  );
});
