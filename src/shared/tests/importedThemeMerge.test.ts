import assert from 'node:assert/strict';

import { test } from 'vitest';

import { mergeImportedThemes } from '@/shared/themes';
import type { ColorTheme } from '@/shared/types';

/**
 * Reinstalling an extension must update its themes, not stack a second copy of
 * every variant next to the first; ids survive so the active theme stays put.
 */

const theme = (id: string, name: string, source?: ColorTheme['source']): ColorTheme => ({
  id,
  name,
  appearance: 'dark',
  previewColors: ['#000000', '#111111', '#222222'],
  tokens: { background: '0 0% 8%' },
  ...(source ? { source } : {}),
});

const OLD = { extensionId: 'Catppuccin.catppuccin-vsc', version: '3.18.0' };
const NEW = { extensionId: 'catppuccin.catppuccin-vsc', version: '3.19.0' };

test('an update replaces the extension in place and keeps the ids of variants it still ships', () => {
  const existing = [
    theme('imported-file', 'From a file'),
    theme('imported-mocha-a1', 'Mocha', OLD),
    theme('imported-latte-b2', 'Latte', OLD),
    theme('imported-other', 'Other'),
  ];

  const { themes, ids } = mergeImportedThemes(
    existing,
    [theme('imported-mocha-zz', 'Mocha'), theme('imported-latte-yy', 'Latte'), theme('imported-frappe-xx', 'Frappé')],
    NEW,
  );

  assert.deepEqual(ids, ['imported-mocha-a1', 'imported-latte-b2', 'imported-frappe-xx']);
  assert.deepEqual(
    themes.map((entry) => entry.id),
    ['imported-file', 'imported-mocha-a1', 'imported-latte-b2', 'imported-frappe-xx', 'imported-other'],
    'the extension keeps its place in the list, and the case of its id does not matter',
  );
  assert.ok(themes.slice(1, 4).every((entry) => entry.source?.version === '3.19.0'));
});

test('two variants sharing a name never end up sharing an id', () => {
  const existing = [theme('imported-night-1', 'Night', OLD)];

  const { ids } = mergeImportedThemes(existing, [theme('a', 'Night'), theme('b', 'Night')], NEW);

  assert.deepEqual(ids, ['imported-night-1', 'b']);
});

test('a theme imported from a file is added alongside, replacing only an identical id', () => {
  const existing = [theme('imported-mocha-a1', 'Mocha', OLD), theme('imported-same', 'Old copy')];

  const { themes, ids } = mergeImportedThemes(existing, [theme('imported-same', 'New copy'), theme('imported-new', 'New')]);

  assert.deepEqual(ids, ['imported-same', 'imported-new']);
  assert.deepEqual(themes.map((entry) => entry.name), ['Mocha', 'New copy', 'New']);
  assert.equal(themes[1].source, undefined);
});
