import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const sourcePath = fileURLToPath(new URL('./ChatComposer.tsx', import.meta.url));

test('activity indicator participates in composer layout instead of overlaying messages', () => {
  const source = readFileSync(sourcePath, 'utf8');

  assert.doesNotMatch(source, /pointer-events-none\s+absolute\s+bottom-full/);
  assert.match(source, /ActivityIndicator/);
});
