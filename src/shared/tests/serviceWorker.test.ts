import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { runInNewContext } from 'node:vm';

import { test } from 'vitest';

const SERVICE_WORKER_SOURCE = readFileSync('public/sw.js', 'utf8');

type ManifestFetchEvent = {
  request: Request;
  respondWith: (response: Promise<Response | undefined>) => void;
};

type WorkerDependencies = {
  fetch: () => Promise<Response>;
  caches: {
    open: () => Promise<{ put: () => Promise<void> }>;
    match: () => Promise<Response | undefined>;
  };
};

async function fetchManifest(dependencies: WorkerDependencies) {
  const listeners = new Map<string, (event: ManifestFetchEvent) => void>();
  runInNewContext(SERVICE_WORKER_SOURCE, {
    ...dependencies,
    URL,
    Response,
    self: {
      addEventListener: (name: string, listener: (event: ManifestFetchEvent) => void) => {
        listeners.set(name, listener);
      },
    },
  });

  const onFetch = listeners.get('fetch');
  assert.ok(onFetch, 'service worker must register a fetch handler');
  return new Promise<Response | undefined>((resolve) => {
    onFetch({
      request: new Request('https://cloudcli.example/manifest.json'),
      respondWith: resolve,
    });
  });
}

test('manifest fetch returns fresh content when opening the cache fails', async () => {
  const fresh = new Response('{"name":"Fresh manifest"}');
  const response = await fetchManifest({
    fetch: async () => fresh,
    caches: {
      open: async () => { throw new Error('Cache storage unavailable'); },
      match: async () => new Response('{"name":"Stale manifest"}'),
    },
  });

  assert.equal(await response?.text(), '{"name":"Fresh manifest"}');
});

test('manifest fetch returns fresh content when writing the cache fails', async () => {
  const fresh = new Response('{"name":"Fresh manifest"}');
  const response = await fetchManifest({
    fetch: async () => fresh,
    caches: {
      open: async () => ({
        put: async () => { throw new Error('Cache quota exceeded'); },
      }),
      match: async () => new Response('{"name":"Stale manifest"}'),
    },
  });

  assert.equal(await response?.text(), '{"name":"Fresh manifest"}');
});

test('manifest fetch falls back to cached content when the network fails', async () => {
  const cached = new Response('{"name":"Offline manifest"}');
  const response = await fetchManifest({
    fetch: async () => { throw new TypeError('Network unavailable'); },
    caches: {
      open: async () => ({ put: async () => {} }),
      match: async () => cached,
    },
  });

  assert.equal(await response?.text(), '{"name":"Offline manifest"}');
});
