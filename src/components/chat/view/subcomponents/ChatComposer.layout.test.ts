import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('ChatComposer activity indicator participates in layout instead of overlaying messages', async () => {
  const source = await readFile(new URL('./ChatComposer.tsx', import.meta.url), 'utf8');

  assert.equal(source.includes('pointer-events-none absolute bottom-full'), false);
});
