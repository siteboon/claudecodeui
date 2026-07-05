import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('mobile terminal keeps native scrolling passive and avoids custom inertia', async () => {
  const source = await readFile(new URL('./mobileTerminalSelection.ts', import.meta.url), 'utf8');

  assert.match(
    source,
    /terminal\.element\.addEventListener\('touchmove', this\.onTerminalTouchMove, \{\s*passive: true,\s*\}\)/,
  );
  assert.equal(source.includes('requestAnimationFrame'), false);
  assert.equal(source.includes('maybeStartInertia'), false);
});
