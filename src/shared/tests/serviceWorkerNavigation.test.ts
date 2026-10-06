import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { test } from 'vitest';

type FetchEvent = {
  request: { url: string; mode: string };
  respondWith: (response: unknown) => void;
};

type FetchListener = (event: FetchEvent) => void;

type WorkerEnvironment = {
  /** Value the worker reads from navigator.onLine. */
  onLine: boolean;
  /** Network stub handed to the worker as fetch. */
  fetch: () => Promise<Response>;
};

const SERVICE_WORKER_SOURCE = readFileSync(
  resolve(import.meta.dirname, '../../../public/sw.js'),
  'utf8',
);

// Evaluates public/sw.js against a stub worker scope and returns the fetch
// listener it registers. The worker is a classic script with no exports, so it
// cannot be imported.
const loadFetchListener = (environment: WorkerEnvironment): FetchListener => {
  const listeners = new Map<string, FetchListener>();
  const scope = {
    navigator: { onLine: environment.onLine },
    addEventListener: (type: string, listener: FetchListener) => {
      listeners.set(type, listener);
    },
  };

  new Function('self', 'fetch', SERVICE_WORKER_SOURCE)(scope, environment.fetch);

  const listener = listeners.get('fetch');
  assert.ok(listener, 'sw.js registers a fetch listener');
  return listener;
};

// Dispatches a page navigation to the worker and returns what it passed to
// respondWith, or undefined when it left the request to the browser.
const navigate = (path: string, environment: WorkerEnvironment): Promise<Response> | undefined => {
  let response: Promise<Response> | undefined;
  loadFetchListener(environment)({
    request: { url: `https://cloudcli.example${path}`, mode: 'navigate' },
    respondWith: (value) => {
      response = value as Promise<Response>;
    },
  });
  return response;
};

test('service worker: page navigations are left to the browser while online', () => {
  const online: WorkerEnvironment = {
    onLine: true,
    fetch: () => Promise.reject(new Error('the worker must not fetch a navigation while online')),
  };

  assert.equal(navigate('/', online), undefined);
  assert.equal(navigate('/session/abc', online), undefined);
});

test('service worker: an offline navigation falls back to the offline page', async () => {
  const response = navigate('/', {
    onLine: false,
    fetch: () => Promise.reject(new TypeError('Failed to fetch')),
  });

  assert.ok(response, 'the worker answers the navigation');
  const page = await response;
  assert.equal(page.headers.get('Content-Type'), 'text/html');
  assert.match(await page.text(), /Offline/);
});

test('service worker: an offline navigation still uses a reachable server', async () => {
  const served = new Response('<div id="root"></div>');
  const response = navigate('/', {
    onLine: false,
    fetch: () => Promise.resolve(served),
  });

  assert.ok(response, 'the worker answers the navigation');
  assert.equal(await response, served);
});
