import assert from 'node:assert/strict';

import { test, vi } from 'vitest';

let fetches = 0;
vi.mock('@/shared/api', () => ({
  api: { plugins: { asset: vi.fn(async () => { fetches += 1; return { ok: false, status: 500 }; }) } },
}));

test('invalidating a plugin drops its cached module so the next load fetches again', async () => {
  const { loadToolRendererModule, invalidateToolRendererModules } = await import('@/modules/plugins/tool-renderers/loadToolRendererModule');
  // A failed load is not cached; make the first load succeed-ish by keeping its pending promise.
  const first = loadToolRendererModule('p', 'dist/index.js');
  const second = loadToolRendererModule('p', 'dist/index.js');
  assert.equal(first, second, 'concurrent loads share one request');
  await first.catch(() => undefined);
  invalidateToolRendererModules('p');
  const third = loadToolRendererModule('p', 'dist/index.js');
  assert.notEqual(third, first);
  await third.catch(() => undefined);
  assert.equal(fetches, 2);
});
