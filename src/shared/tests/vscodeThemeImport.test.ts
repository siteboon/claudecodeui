import assert from 'node:assert/strict';

import { test } from 'vitest';

import { VsCodeThemeImportError, parseVsCodeTheme } from '@/shared/themes/vscodeThemeImport';

/**
 * The importer's job is to survive real marketplace theme files: JSON with
 * comments, translucent surfaces, and any subset of the ~200 workbench colour
 * keys. Everything it cannot read has to fail as a message a user can act on
 * rather than as a broken palette.
 */

const minimalTheme = (extra: Record<string, unknown> = {}) => JSON.stringify({
  name: 'Test Theme',
  type: 'dark',
  colors: {
    'editor.background': '#000000',
    'editor.foreground': '#ffffff',
    ...extra,
  },
});

test('maps the editor surfaces onto the app palette as HSL triplets', () => {
  const theme = parseVsCodeTheme(minimalTheme());

  assert.equal(theme.tokens?.background, '0 0% 0%');
  assert.equal(theme.tokens?.foreground, '0 0% 100%');
  assert.equal(theme.name, 'Test Theme');
  assert.equal(theme.appearance, 'dark');
  assert.ok(theme.id.startsWith('imported-test-theme-'));
});

test('reads a theme whose colours carry an alpha channel', () => {
  // #ffffff80 over a black editor background is mid grey, and only a flattened
  // value can be stored: an `hsl()` triplet has nowhere to put the alpha.
  const theme = parseVsCodeTheme(minimalTheme({ 'list.hoverBackground': '#ffffff80' }));

  assert.equal(theme.tokens?.muted, '0 0% 50.2%');
});

test('accepts the comments and trailing commas VS Code allows', () => {
  const source = `{
    // The theme's own notes
    "name": "Commented",
    "type": "light",
    /* block comment */
    "colors": {
      "editor.background": "#ffffff",
      "editor.foreground": "#000000",
    },
  }`;

  const theme = parseVsCodeTheme(source);

  assert.equal(theme.name, 'Commented');
  assert.equal(theme.appearance, 'light');
});

test('leaves a // inside a string alone', () => {
  const source = JSON.stringify({
    name: 'https://example.com theme',
    type: 'dark',
    colors: { 'editor.background': '#101010', 'editor.foreground': '#eeeeee' },
  });

  assert.equal(parseVsCodeTheme(source).name, 'https://example.com theme');
});

test('leaves a comma inside a string value alone', () => {
  // A blanket trailing-comma regex turns "Night,}" into "Night}", importing the
  // theme under a name it never had.
  const source = JSON.stringify({
    name: 'Night,}',
    type: 'dark',
    colors: { 'editor.background': '#000000', 'editor.foreground': '#ffffff' },
  });

  assert.equal(parseVsCodeTheme(source).name, 'Night,}');
});

test('classifies a theme that declares no type by how bright it is', () => {
  const light = parseVsCodeTheme(JSON.stringify({
    colors: { 'editor.background': '#fafafa', 'editor.foreground': '#202020' },
  }));
  const dark = parseVsCodeTheme(JSON.stringify({
    colors: { 'editor.background': '#101010', 'editor.foreground': '#eeeeee' },
  }));

  assert.equal(light.appearance, 'light');
  assert.equal(dark.appearance, 'dark');
});

test('treats the high-contrast variants as the light or dark themes they are', () => {
  const source = (type: string) => JSON.stringify({
    type,
    colors: { 'editor.background': '#000000', 'editor.foreground': '#ffffff' },
  });

  assert.equal(parseVsCodeTheme(source('hcDark')).appearance, 'dark');
  // Declared light despite the near-black background, because the file says so.
  assert.equal(parseVsCodeTheme(source('hcLight')).appearance, 'light');
});

test('falls back to the file name when the theme names itself in package.json instead', () => {
  const source = JSON.stringify({
    colors: { 'editor.background': '#000000', 'editor.foreground': '#ffffff' },
  });

  assert.equal(parseVsCodeTheme(source, 'monokai').name, 'monokai');
});

test('derives every role a theme leaves out', () => {
  const theme = parseVsCodeTheme(minimalTheme());
  const tokens = theme.tokens ?? {};

  for (const role of ['card', 'popover', 'primary', 'muted', 'border', 'input', 'ring', 'destructive']) {
    assert.ok(tokens[role], `${role} should have been derived`);
  }
  // A derived surface still has to be distinguishable from the background.
  assert.notEqual(tokens.card, tokens.background);
});

test('takes the accent from the badge rather than the button chrome', () => {
  // One Dark Pro's shape: a flat grey button and the real accent on the badge.
  const theme = parseVsCodeTheme(minimalTheme({
    'button.background': '#404754',
    'activityBarBadge.background': '#4d78cc',
  }));

  // 55% saturation, not the 14% of the grey it would otherwise have taken.
  assert.equal(theme.tokens?.primary, '219.69 55.46% 55.1%');
});

test('keeps text on the accent legible when the theme has no dark foreground', () => {
  // Solarized Light's shape: a yellow accent under a mid-grey foreground, which
  // is unreadable on it. Neither of the theme's own colours will do.
  const theme = parseVsCodeTheme(JSON.stringify({
    type: 'light',
    colors: {
      'editor.background': '#fdf6e3',
      'editor.foreground': '#657b83',
      'activityBarBadge.background': '#b58900',
    },
  }));

  assert.equal(theme.tokens?.['primary-foreground'], '0 0% 0%');
});

test('rejects a file that is not a colour theme', () => {
  assert.throws(
    () => parseVsCodeTheme('{"contributes":{"themes":[]}}'),
    VsCodeThemeImportError,
  );
  assert.throws(() => parseVsCodeTheme('not json at all'), VsCodeThemeImportError);
  // The `include`-only files inside an extension carry no colours of their own.
  assert.throws(
    () => parseVsCodeTheme('{"include":"./base.json","colors":{}}'),
    VsCodeThemeImportError,
  );
});
