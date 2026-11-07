import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, test } from 'vitest';

import { ThemeProvider, useTheme } from '@/shared/context/ThemeContext';
import {
  readUserPreference,
  resetUserPreferences,
  writeUserPreference,
} from '@/shared/userSettings';

/**
 * The theme is stored server-side, so the provider has to distinguish a theme
 * the user picked from one this device merely started on. Persisting the
 * latter — which an effect keyed on the state does, on mount, before the stored
 * theme has been fetched — writes a device's system default over the user's
 * real choice on every other device.
 */

const wrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(ThemeProvider, null, children);

const originalMatchMedia = window.matchMedia;
/** Listeners the provider registered on the emulated `prefers-color-scheme` query. */
let colorSchemeListeners: Array<(event: MediaQueryListEvent) => void> = [];

/**
 * Emulates an OS appearance so `system` mode has something to follow. jsdom's
 * `matchMedia` is a static stub, so the change event has to be driven by hand.
 */
const emulateSystemDarkAppearance = (matches: boolean) => {
  colorSchemeListeners = [];
  window.matchMedia = ((query: string) => ({
    matches: query.includes('prefers-color-scheme: dark') ? matches : false,
    media: query,
    onchange: null,
    addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
      colorSchemeListeners.push(listener);
    },
    removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
      colorSchemeListeners = colorSchemeListeners.filter((entry) => entry !== listener);
    },
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
};

const changeSystemAppearance = (matches: boolean) => {
  colorSchemeListeners.forEach((listener) => listener({ matches } as MediaQueryListEvent));
};

beforeEach(() => {
  localStorage.clear();
  // The preference store is a module-level singleton, so its in-memory copy
  // outlives localStorage.clear() and would leak one test's writes into the next.
  resetUserPreferences();
  document.documentElement.classList.remove('dark');
  emulateSystemDarkAppearance(false);
});

afterEach(() => {
  window.matchMedia = originalMatchMedia;
  colorSchemeListeners = [];
});

test('mounting stores no theme for a user who has never chosen one', () => {
  renderHook(() => useTheme(), { wrapper });

  assert.equal(
    readUserPreference<unknown>('theme', null),
    null,
    'a device must not record the theme it happened to start on',
  );
});

test('mounting does not overwrite the stored theme', () => {
  writeUserPreference('theme', 'dark');

  renderHook(() => useTheme(), { wrapper });

  assert.equal(readUserPreference('theme', null), 'dark');
});

test('a stored theme is applied on the first render', () => {
  writeUserPreference('theme', 'dark');

  const { result } = renderHook(() => useTheme(), { wrapper });

  assert.equal(result.current.isDarkMode, true);
  assert.ok(document.documentElement.classList.contains('dark'));
});

test('toggling stores the theme the user picked', () => {
  const { result } = renderHook(() => useTheme(), { wrapper });
  assert.equal(result.current.isDarkMode, false);

  act(() => {
    result.current.toggleDarkMode();
  });

  assert.equal(result.current.isDarkMode, true);
  assert.equal(readUserPreference('theme', null), 'dark');
  assert.ok(document.documentElement.classList.contains('dark'));
});

test('a theme arriving from the store is applied without being written back', () => {
  const { result } = renderHook(() => useTheme(), { wrapper });

  act(() => {
    // Stands in for a hydrate delivering the theme chosen on another device.
    writeUserPreference('theme', 'dark');
  });

  assert.equal(result.current.isDarkMode, true);
  assert.equal(readUserPreference('theme', null), 'dark');
});

test('a user who has never chosen a theme is following the system', () => {
  emulateSystemDarkAppearance(true);

  const { result } = renderHook(() => useTheme(), { wrapper });

  assert.equal(result.current.themeMode, 'system');
  assert.equal(result.current.isDarkMode, true);
  assert.equal(
    readUserPreference<unknown>('theme', null),
    null,
    'following the system is the default, not something to record',
  );
});

test('choosing "system" is stored and resolves against the OS', () => {
  emulateSystemDarkAppearance(true);
  writeUserPreference('theme', 'light');

  const { result } = renderHook(() => useTheme(), { wrapper });
  assert.equal(result.current.isDarkMode, false);

  act(() => {
    result.current.setThemeMode('system');
  });

  assert.equal(result.current.themeMode, 'system');
  assert.equal(result.current.isDarkMode, true);
  assert.equal(readUserPreference('theme', null), 'system');
});

test('the OS switching appearance flips the theme while following the system', () => {
  writeUserPreference('theme', 'system');

  const { result } = renderHook(() => useTheme(), { wrapper });
  assert.equal(result.current.isDarkMode, false);

  act(() => {
    changeSystemAppearance(true);
  });

  assert.equal(result.current.isDarkMode, true);
  assert.ok(document.documentElement.classList.contains('dark'));
});

test('the OS switching appearance leaves a pinned theme alone', () => {
  writeUserPreference('theme', 'light');

  const { result } = renderHook(() => useTheme(), { wrapper });

  act(() => {
    changeSystemAppearance(true);
  });

  assert.equal(result.current.themeMode, 'light');
  assert.equal(result.current.isDarkMode, false);
});

test('an explicit toggle leaves system mode behind', () => {
  writeUserPreference('theme', 'system');

  const { result } = renderHook(() => useTheme(), { wrapper });

  act(() => {
    result.current.toggleDarkMode();
  });

  assert.equal(result.current.themeMode, 'dark');
  assert.equal(readUserPreference('theme', null), 'dark');
});

test('a stored value written by a newer client falls back to following the system', () => {
  emulateSystemDarkAppearance(true);
  writeUserPreference('theme', 'solarized');

  const { result } = renderHook(() => useTheme(), { wrapper });

  assert.equal(result.current.themeMode, 'system');
  assert.equal(result.current.isDarkMode, true);
});
