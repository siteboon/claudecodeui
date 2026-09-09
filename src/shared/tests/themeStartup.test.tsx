import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { act, renderHook } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, test, vi } from 'vitest';

const html = readFileSync('index.html', 'utf8');
let serverPreferences: Record<string, unknown> = {};
let preferencesStatus = 200;
const saved: Record<string, unknown>[] = [];
let systemIsDark = false;
let systemChanges = new EventTarget();

vi.mock('@/shared/api', () => ({
  api: {
    user: {
      preferences: async () => new Response(JSON.stringify({ preferences: serverPreferences }), { status: preferencesStatus }),
      savePreferences: async (updates: Record<string, unknown>) => {
        saved.push(updates);
        return new Response('{}');
      },
    },
  },
}));

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  serverPreferences = {};
  preferencesStatus = 200;
  saved.length = 0;
  systemIsDark = false;
  systemChanges = new EventTarget();
  vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
    get matches() { return systemIsDark; },
    media: query,
    onchange: null,
    addEventListener: systemChanges.addEventListener.bind(systemChanges),
    removeEventListener: systemChanges.removeEventListener.bind(systemChanges),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: systemChanges.dispatchEvent.bind(systemChanges),
  }));
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  document.head.innerHTML = '';
  document.documentElement.classList.remove('dark');
});

function boot() {
  const documentFromHtml = new DOMParser().parseFromString(html, 'text/html');
  document.head.innerHTML = documentFromHtml.head.innerHTML;
  const script = documentFromHtml.querySelector('script:not([src])')?.textContent;
  assert.ok(script, 'index.html must include the pre-paint theme script');
  window.eval(script);
}

async function mountTheme() {
  // Static imports cannot exercise the store's module-load read on each simulated reload.
  vi.resetModules();
  const store = await import('@/shared/userSettings');
  const { ThemeProvider, useTheme } = await import('@/shared/context/ThemeContext');
  const hook = renderHook(() => useTheme(), {
    wrapper: ({ children }) => React.createElement(ThemeProvider, null, children),
  });
  return { ...hook, store };
}

function assertTheme(isDark: boolean) {
  assert.equal(document.documentElement.classList.contains('dark'), isDark);
  for (const name of ['theme-color', 'msapplication-TileColor']) {
    assert.equal(document.querySelector(`meta[name="${name}"]`)?.getAttribute('content'),
      isDark ? '#141414' : '#f6f4ef');
  }
}

function changeSystemTheme(isDark: boolean) {
  act(() => {
    systemIsDark = isDark;
    systemChanges.dispatchEvent(Object.assign(new Event('change'), { matches: isDark }));
  });
}

test('legacy-only startup agrees with boot, then yields to server changes and resets across reloads', async () => {
  localStorage.setItem('theme', 'dark');
  boot();
  assertTheme(true);
  const { result, store, unmount } = await mountTheme();
  assert.equal(result.current.isDarkMode, true);
  assertTheme(true);

  serverPreferences = { theme: 'light' };
  await act(() => store.hydrateUserPreferences());
  assert.equal(result.current.isDarkMode, false);
  assertTheme(false);

  serverPreferences = {};
  await act(() => store.hydrateUserPreferences());
  changeSystemTheme(true);
  assert.equal(result.current.isDarkMode, true);
  await vi.advanceTimersByTimeAsync(500);
  assert.deepEqual(saved, [], 'stale legacy theme must not be migrated over the server again');

  unmount();
  systemIsDark = false;
  boot();
  assertTheme(false);
  const reloaded = await mountTheme();
  assert.equal(reloaded.result.current.isDarkMode, false);
});

test('unsupported mirrored theme follows system instead of stale legacy, while explicit toggles update both colors', async () => {
  localStorage.setItem('user-preferences', JSON.stringify({ theme: 'system' }));
  localStorage.setItem('theme', 'dark');
  boot();
  assertTheme(false);
  const { result, store } = await mountTheme();
  assert.equal(result.current.isDarkMode, false);
  changeSystemTheme(true);
  assert.equal(result.current.isDarkMode, true);
  assertTheme(true);

  act(() => result.current.toggleDarkMode());
  assertTheme(false);
  assert.equal(store.readUserPreference('theme', null), 'light');
  changeSystemTheme(false);
  changeSystemTheme(true);
  assert.equal(result.current.isDarkMode, false);
  act(() => result.current.toggleDarkMode());
  assertTheme(true);
});

test('an auth reset preserves unmigrated theme, but a server-owned theme never revives after reset', async () => {
  localStorage.setItem('theme', 'dark');
  boot();
  const { result, store, unmount } = await mountTheme();
  assert.equal(result.current.isDarkMode, true);
  act(() => store.resetUserPreferences());
  assert.equal(result.current.isDarkMode, false);
  assertTheme(false);

  // An expired token can reset the store before the first authenticated migration.
  await act(() => store.hydrateUserPreferences());
  assert.equal(result.current.isDarkMode, true);
  await vi.advanceTimersByTimeAsync(500);
  assert.deepEqual(saved, [{ theme: 'dark' }]);

  serverPreferences = { theme: 'dark' };
  await act(() => store.hydrateUserPreferences());
  act(() => store.resetUserPreferences());
  assertTheme(false);
  unmount();

  boot();
  assertTheme(false);
  const reloaded = await mountTheme();
  assert.equal(reloaded.result.current.isDarkMode, false);
});

test('malformed mirror uses legacy, and blocked storage leaves boot and runtime following system', async () => {
  localStorage.setItem('user-preferences', '{broken');
  localStorage.setItem('theme', 'dark');
  boot();
  assertTheme(true);
  const legacy = await mountTheme();
  assert.equal(legacy.result.current.isDarkMode, true);
  legacy.unmount();

  vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
    throw new DOMException('Storage blocked', 'SecurityError');
  });
  boot();
  assertTheme(false);
  const blocked = await mountTheme();
  assert.equal(blocked.result.current.isDarkMode, false);
  changeSystemTheme(true);
  assert.equal(blocked.result.current.isDarkMode, true);
  assertTheme(true);
});

test('HTTP errors preserve the current theme while a successful server reset follows system', async () => {
  localStorage.setItem('user-preferences', JSON.stringify({ theme: 'dark' }));
  boot();
  const { result, store } = await mountTheme();

  preferencesStatus = 503;
  await act(() => store.hydrateUserPreferences());
  assert.equal(result.current.isDarkMode, true);
  assertTheme(true);
  assert.equal(store.hasHydratedUserPreferences(), false);

  preferencesStatus = 200;
  serverPreferences = { theme: null };
  await act(() => store.hydrateUserPreferences());
  assertTheme(false);
});

test('a queued theme choice survives hydration without a server value and supersedes legacy migration', async () => {
  systemIsDark = true;
  localStorage.setItem('theme', 'dark');
  boot();
  const { result, store } = await mountTheme();
  act(() => result.current.toggleDarkMode());

  await act(() => store.hydrateUserPreferences());
  assert.equal(result.current.isDarkMode, false);
  assertTheme(false);
  await vi.advanceTimersByTimeAsync(500);
  assert.deepEqual(saved, [{ theme: 'light' }]);
});
