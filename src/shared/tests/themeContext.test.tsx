import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import React from 'react';
import { beforeEach, test } from 'vitest';

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

beforeEach(() => {
  localStorage.clear();
  // The preference store is a module-level singleton, so its in-memory copy
  // outlives localStorage.clear() and would leak one test's writes into the next.
  resetUserPreferences();
  document.documentElement.classList.remove('dark');
  delete document.documentElement.dataset.theme;
  document.getElementById('imported-color-themes')?.remove();
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

/**
 * The palette is a second axis on top of light/dark. An imported palette states
 * which of the two it is, and the `dark` class has to follow that statement:
 * hundreds of `dark:`-prefixed utility classes read it, so a dark palette
 * rendered without it would show light-mode text on dark surfaces.
 */

const importedTheme = (id: string, appearance: 'light' | 'dark') => ({
  id,
  name: id,
  appearance,
  previewColors: ['#000000', '#111111', '#cba6f7'] as [string, string, string],
  tokens: { background: appearance === 'dark' ? '0 0% 8%' : '0 0% 96%' },
});

test('the default theme leaves light and dark to the user', () => {
  const { result } = renderHook(() => useTheme(), { wrapper });

  assert.equal(result.current.colorTheme, 'default');
  assert.equal(result.current.canToggleDarkMode, true);
  assert.equal(document.documentElement.dataset.theme, 'default');
});

test('picking a theme records it and marks the document', () => {
  const { result } = renderHook(() => useTheme(), { wrapper });

  act(() => {
    result.current.addImportedTheme(importedTheme('imported-dark', 'dark'));
  });
  act(() => {
    result.current.setColorTheme('imported-dark');
  });

  assert.equal(readUserPreference('colorTheme', null), 'imported-dark');
  assert.equal(document.documentElement.dataset.theme, 'imported-dark');
});

test('a theme that fixes its appearance drives the dark class', () => {
  const { result } = renderHook(() => useTheme(), { wrapper });

  act(() => {
    result.current.addImportedTheme(importedTheme('imported-dark', 'dark'));
    result.current.addImportedTheme(importedTheme('imported-light', 'light'));
  });

  act(() => {
    result.current.setColorTheme('imported-dark');
  });
  assert.equal(result.current.isDarkMode, true);
  assert.equal(result.current.canToggleDarkMode, false);
  assert.ok(document.documentElement.classList.contains('dark'));

  act(() => {
    result.current.setColorTheme('imported-light');
  });
  assert.equal(result.current.isDarkMode, false);
  assert.ok(!document.documentElement.classList.contains('dark'));
});

test('the light/dark choice survives a detour through a fixed theme', () => {
  writeUserPreference('theme', 'dark');
  const { result } = renderHook(() => useTheme(), { wrapper });

  act(() => {
    result.current.addImportedTheme(importedTheme('imported-light', 'light'));
  });
  act(() => {
    result.current.setColorTheme('imported-light');
  });
  assert.equal(result.current.isDarkMode, false, 'the palette wins while it is active');

  act(() => {
    result.current.setColorTheme('default');
  });

  assert.equal(result.current.isDarkMode, true, "the user's own choice comes back");
  assert.equal(readUserPreference('theme', null), 'dark');
});

test('an imported theme is applied from its own stored variables', () => {
  const { result } = renderHook(() => useTheme(), { wrapper });

  act(() => {
    result.current.addImportedTheme({
      id: 'imported-test-1',
      name: 'Imported',
      appearance: 'dark',
      previewColors: ['#000000', '#111111', '#89b4fa'],
      tokens: { background: '0 0% 0%', foreground: '0 0% 100%' },
    });
  });
  act(() => {
    result.current.setColorTheme('imported-test-1');
  });

  const injected = document.getElementById('imported-color-themes');
  assert.ok(injected, 'the imported palette needs a stylesheet to live in');
  assert.match(injected.textContent ?? '', /:root\[data-theme="imported-test-1"\]/);
  assert.match(injected.textContent ?? '', /--background: 0 0% 0%;/);
  assert.equal(document.documentElement.dataset.theme, 'imported-test-1');
  assert.ok(document.documentElement.classList.contains('dark'));
});

test('deleting the theme in use falls back to the default rather than to nothing', () => {
  const { result } = renderHook(() => useTheme(), { wrapper });

  act(() => {
    result.current.addImportedTheme({
      id: 'imported-test-2',
      name: 'Imported',
      appearance: 'dark',
      previewColors: ['#000000', '#111111', '#89b4fa'],
      tokens: { background: '0 0% 0%' },
    });
  });
  act(() => {
    result.current.setColorTheme('imported-test-2');
  });
  act(() => {
    result.current.removeImportedTheme('imported-test-2');
  });

  assert.equal(result.current.colorTheme, 'default');
  assert.equal(readUserPreference('colorTheme', null), 'default');
  assert.equal(document.documentElement.dataset.theme, 'default');
  assert.ok(!document.getElementById('imported-color-themes'));
});

test('a theme id whose theme is gone falls back without erasing the stored choice', () => {
  // The shape of deleting an imported palette on another device.
  writeUserPreference('colorTheme', 'imported-deleted-elsewhere');

  const { result } = renderHook(() => useTheme(), { wrapper });

  assert.equal(result.current.colorTheme, 'default');
  assert.equal(
    readUserPreference('colorTheme', null),
    'imported-deleted-elsewhere',
    'the choice stays stored in case the theme comes back',
  );
});
