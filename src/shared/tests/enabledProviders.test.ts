import assert from 'node:assert/strict';

import { beforeEach, test, vi } from 'vitest';

/**
 * VITE_ENABLED_PROVIDERS (#349) is read by the server and delivered through
 * GET /api/providers/enabled. These pin the frontend half: the list the UI
 * offers, the default provider of a new chat, and what happens to a stored
 * provider the server no longer enables.
 */

const ALL_PROVIDERS = ['claude', 'codex', 'cursor', 'opencode'];

let enabledResponse: () => Promise<unknown> = () => Promise.resolve({
  ok: true,
  json: async () => ({ success: true, data: { providers: ALL_PROVIDERS } }),
});

const respondWith = (providers: unknown) => {
  enabledResponse = () => Promise.resolve({
    ok: true,
    json: async () => ({ success: true, data: { providers } }),
  });
};

vi.mock('@/shared/api', () => ({
  api: {
    providers: {
      enabled: () => enabledResponse(),
    },
    // The preference store PATCHes through api.user; stubbed so the stored
    // provider can be written without a server.
    user: {
      preferences: () => Promise.resolve({ ok: true, json: async () => ({ preferences: {} }) }),
      savePreferences: () => Promise.resolve({ ok: true, json: async () => ({}) }),
    },
  },
}));

// The stores are module-level singletons; a fresh copy per test keeps one
// test's list or stored provider from leaking into the next.
const loadStores = async () => {
  const enabled = await import('@/shared/enabledProviders');
  const selected = await import('@/shared/selectedProvider');
  const settings = await import('@/shared/userSettings');
  return { ...enabled, ...selected, ...settings };
};

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
  respondWith(ALL_PROVIDERS);
});

test('every provider is offered until the server answers', async () => {
  const { readEnabledProviders, readSelectedProvider } = await loadStores();

  assert.deepEqual(readEnabledProviders(), ALL_PROVIDERS);
  assert.equal(readSelectedProvider(), 'claude');
});

test('the server list is adopted in its own order', async () => {
  const { hydrateEnabledProviders, readEnabledProviders } = await loadStores();
  respondWith(['codex', 'claude']);

  await hydrateEnabledProviders();

  assert.deepEqual(readEnabledProviders(), ['codex', 'claude']);
});

test('unknown and repeated ids from the server are dropped', async () => {
  const { hydrateEnabledProviders, readEnabledProviders } = await loadStores();
  respondWith(['claude', 'gemini', 'claude', 42]);

  await hydrateEnabledProviders();

  assert.deepEqual(readEnabledProviders(), ['claude']);
});

test('an unusable answer or a failed request keeps every provider', async () => {
  const { hydrateEnabledProviders, readEnabledProviders } = await loadStores();
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

  respondWith([]);
  await hydrateEnabledProviders();
  assert.deepEqual(readEnabledProviders(), ALL_PROVIDERS);

  respondWith('claude');
  await hydrateEnabledProviders();
  assert.deepEqual(readEnabledProviders(), ALL_PROVIDERS);

  enabledResponse = () => Promise.resolve({ ok: false, json: async () => ({}) });
  await hydrateEnabledProviders();
  assert.deepEqual(readEnabledProviders(), ALL_PROVIDERS);

  enabledResponse = () => Promise.reject(new Error('offline'));
  await hydrateEnabledProviders();
  assert.deepEqual(readEnabledProviders(), ALL_PROVIDERS);

  errorSpy.mockRestore();
});

test('subscribers hear about a change, but not about the same list again', async () => {
  const { hydrateEnabledProviders, subscribeToEnabledProviders } = await loadStores();
  let notifications = 0;
  const unsubscribe = subscribeToEnabledProviders(() => {
    notifications += 1;
  });

  respondWith(['codex']);
  await hydrateEnabledProviders();
  await hydrateEnabledProviders();
  unsubscribe();

  assert.equal(notifications, 1);
});

test('with nothing stored, the first enabled provider is the default', async () => {
  const { hydrateEnabledProviders, readSelectedProvider } = await loadStores();
  respondWith(['codex', 'claude']);

  await hydrateEnabledProviders();

  assert.equal(readSelectedProvider(), 'codex');
});

test('a stored provider that is still enabled is kept', async () => {
  const { hydrateEnabledProviders, readSelectedProvider, writeSelectedProvider } = await loadStores();
  respondWith(['codex', 'claude']);
  writeSelectedProvider('claude');

  await hydrateEnabledProviders();

  assert.equal(readSelectedProvider(), 'claude');
});

test('a stored provider the server disabled reads as the first enabled one', async () => {
  const { hydrateEnabledProviders, readSelectedProvider, writeSelectedProvider } = await loadStores();
  respondWith(['claude']);
  writeSelectedProvider('cursor');

  await hydrateEnabledProviders();

  assert.equal(readSelectedProvider(), 'claude');
});

test('reconciling rewrites a disabled stored provider so storage agrees', async () => {
  const {
    hydrateEnabledProviders,
    readUserPreference,
    reconcileSelectedProvider,
    writeSelectedProvider,
  } = await loadStores();
  respondWith(['codex', 'claude']);
  writeSelectedProvider('cursor');
  await hydrateEnabledProviders();

  reconcileSelectedProvider();

  assert.equal(readUserPreference('selectedProvider', null), 'codex');
});

test('reconciling leaves an enabled or absent stored provider alone', async () => {
  const {
    hydrateEnabledProviders,
    readUserPreference,
    reconcileSelectedProvider,
    writeSelectedProvider,
    resetUserPreferences,
  } = await loadStores();
  respondWith(['codex', 'claude']);
  await hydrateEnabledProviders();

  reconcileSelectedProvider();
  assert.equal(readUserPreference('selectedProvider', null), null);

  writeSelectedProvider('claude');
  reconcileSelectedProvider();
  assert.equal(readUserPreference('selectedProvider', null), 'claude');

  resetUserPreferences();
});
