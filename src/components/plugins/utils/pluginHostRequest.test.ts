import assert from 'node:assert/strict';
import test from 'node:test';

import type { PluginContext } from './pluginHostRequest';
import {
  PLUGIN_HOST_API_VERSION,
  buildPluginHostRequestInit,
  createPluginApi,
  normalizePluginHostPath,
} from './pluginHostRequest';

test('the host request is always a GET, whatever the plugin asked for', () => {
  const init = buildPluginHostRequestInit({ headers: { 'X-Trace': '1' } });

  assert.equal(init.method, 'GET');
  assert.deepEqual(init.headers, { 'X-Trace': '1' });

  // A plugin passing a method through does not change anything: the field is
  // not part of the accepted init and the method is set by the host.
  const forced = buildPluginHostRequestInit({ method: 'POST', body: 'x' } as never);
  assert.equal(forced.method, 'GET');
  assert.equal((forced as { body?: unknown }).body, undefined);
});

test('only same-origin, non-traversing /api/ paths are accepted', () => {
  assert.equal(normalizePluginHostPath('/api/projects?skipSync=1'), '/api/projects?skipSync=1');
  assert.equal(normalizePluginHostPath('/api/projects/abc/sessions?limit=1'), '/api/projects/abc/sessions?limit=1');

  for (const rejected of [
    '/etc/passwd',
    '//evil.example/x',
    '/api/../secret',
    '/api/%2e%2e/secret',
    'https://evil.example/api/x',
    'api/projects',
    '/apixyz/projects',
    '/api/a\\b',
    '/api/a b',
    '/api/%zz',
    42,
    null,
    undefined,
  ]) {
    assert.equal(normalizePluginHostPath(rejected as never), null, `${String(rejected)} must be rejected`);
  }
});

test('an Authorization header supplied by the plugin is ignored', () => {
  const init = buildPluginHostRequestInit({
    headers: { Authorization: 'Bearer forged', authorization: 'Bearer forged too', Accept: 'application/json' },
  });

  assert.deepEqual(init.headers, { Accept: 'application/json' });
});

test('the api object keeps its existing shape for plugins that ignore host', async () => {
  let context: PluginContext = { theme: 'dark', project: null, session: null };
  const host = { fetch: async () => new Response(), startNewSession() {}, openSession() {} };

  const api = createPluginApi({
    getContext: () => context,
    onContextChange: () => () => undefined,
    rpc: async () => ({ ok: true }),
    getHost: () => host,
  });

  // Pre-existing members, unchanged.
  assert.deepEqual(api.context, context);
  assert.equal(typeof api.onContextChange, 'function');
  assert.equal(typeof api.rpc, 'function');
  assert.deepEqual(await api.rpc('GET', '/x'), { ok: true });

  // Additions are exactly these three, and nothing else appeared.
  assert.equal(api.hostApiVersion, PLUGIN_HOST_API_VERSION);
  assert.equal(api.host, host);
  assert.equal(api.surface, 'tab');
  assert.deepEqual(
    Object.keys(api).sort(),
    ['context', 'host', 'hostApiVersion', 'onContextChange', 'rpc', 'surface'],
  );

  // `context` stays a live getter, as before.
  context = { theme: 'light', project: null, session: null };
  assert.equal(api.context.theme, 'light');
});
