import assert from 'node:assert/strict';

import { afterEach, beforeEach, test, vi } from 'vitest';

const assetResponses: Array<() => Promise<{ ok: boolean; status?: number; text?: () => Promise<string> }>> = [];
let fetches = 0;
vi.mock('@/shared/api', () => ({
  api: {
    plugins: {
      asset: vi.fn(() => {
        fetches += 1;
        const next = assetResponses.shift();
        return next ? next() : Promise.resolve({ ok: true, text: async () => 'export const renderTool = () => ({});' });
      }),
    },
  },
}));

// jsdom has no Blob-URL module loading; serve the module source as a data: URL, which Node can import.
const blobSources = new Map<string, string>();
beforeEach(() => {
  fetches = 0;
  assetResponses.length = 0;
  vi.stubGlobal('URL', Object.assign(Object.create(URL), {
    createObjectURL: () => {
      const id = `blob:test-${blobSources.size}`;
      blobSources.set(id, 'data:text/javascript,export%20const%20renderTool%20%3D%20()%20%3D%3E%20(%7B%7D)%3B');
      return blobSources.get(id)!;
    },
    revokeObjectURL: () => undefined,
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

const loader = () => import('@/modules/plugins/tool-renderers/loadToolRendererModule');

test('a successfully cached module is shared, and invalidation makes the next load fetch again', async () => {
  const { loadToolRendererModule, invalidateToolRendererModules } = await loader();
  const first = await loadToolRendererModule('p', 'dist/index.js');
  assert.equal(typeof first.renderTool, 'function');
  await loadToolRendererModule('p', 'dist/index.js');
  assert.equal(fetches, 1, 'cached module is reused');

  invalidateToolRendererModules('p');
  await loadToolRendererModule('p', 'dist/index.js');
  assert.equal(fetches, 2, 'invalidated module is fetched again');
});

test('an old load that fails after an invalidation does not drop the newer cache entry', async () => {
  const { loadToolRendererModule, invalidateToolRendererModules } = await loader();
  let failOld!: () => void;
  assetResponses.push(() => new Promise((resolve) => { failOld = () => resolve({ ok: false, status: 500 }); }));
  const old = loadToolRendererModule('p', 'dist/index.js');

  invalidateToolRendererModules('p');
  const fresh = loadToolRendererModule('p', 'dist/index.js');
  failOld();
  await old.catch(() => undefined);
  await fresh;

  assert.equal(loadToolRendererModule('p', 'dist/index.js'), fresh, 'the newer entry survived');
  assert.equal(fetches, 2);
});
