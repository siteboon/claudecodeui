import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('URL auth token is consumed and stripped even when a token already exists', async () => {
  const source = await readFile(new URL('./bootstrap-url-token.js', import.meta.url), 'utf8');

  assert.match(source, /if \(t\) \{/);
  assert.equal(source.includes('if (t && !localStorage.getItem'), false);
});
