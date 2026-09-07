import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, test } from 'vitest';

import { ThemeProvider, useTheme } from '@/shared/context/ThemeContext';
import { applyStoredColorTheme } from '@/shared/themes';
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
  delete document.documentElement.dataset.theme;
  document.getElementById('imported-color-themes')?.remove();
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

/**
 * Two palettes, one per mode: the light slot shows in light mode and the dark
 * slot in dark mode. The `dark` class always follows the mode, and a slot only
 * takes a palette of its own appearance, so the hundreds of `dark:` utility
 * classes never contradict the variables.
 */

const importedTheme = (id: string, appearance: 'light' | 'dark') => ({
  id,
  name: id,
  appearance,
  previewColors: ['#000000', '#111111', '#cba6f7'] as [string, string, string],
  tokens: { background: appearance === 'dark' ? '0 0% 8%' : '0 0% 96%' },
});

test('both slots start on the default theme, which follows light and dark', () => {
  writeUserPreference('theme', 'dark');
  const { result } = renderHook(() => useTheme(), { wrapper });

  assert.deepEqual(result.current.slotThemes, { light: 'default', dark: 'default' });
  assert.equal(result.current.activeSlot, 'dark');
  assert.equal(document.documentElement.dataset.theme, 'default');
  assert.ok(document.documentElement.classList.contains('dark'));
});

test('the dark-mode setting picks which slot is on screen', () => {
  writeUserPreference('theme', 'light');
  const { result } = renderHook(() => useTheme(), { wrapper });

  act(() => {
    result.current.installImportedThemes([importedTheme('imported-dark', 'dark'), importedTheme('imported-light', 'light')]);
  });
  act(() => {
    result.current.setSlotTheme('dark', 'imported-dark');
    result.current.setSlotTheme('light', 'imported-light');
  });

  assert.equal(readUserPreference('lightColorTheme', null), 'imported-light');
  assert.equal(readUserPreference('darkColorTheme', null), 'imported-dark');
  assert.equal(document.documentElement.dataset.theme, 'imported-light');
  assert.ok(!document.documentElement.classList.contains('dark'));

  act(() => {
    result.current.toggleDarkMode();
  });

  assert.equal(result.current.activeSlot, 'dark');
  assert.equal(document.documentElement.dataset.theme, 'imported-dark');
  assert.ok(document.documentElement.classList.contains('dark'));
});

test('a slot never shows a palette of the other appearance', () => {
  // The shape of a hand-edited or stale preference.
  writeUserPreference('theme', 'light');
  writeUserPreference('importedThemes', [importedTheme('imported-dark', 'dark')]);
  writeUserPreference('lightColorTheme', 'imported-dark');

  const { result } = renderHook(() => useTheme(), { wrapper });

  assert.equal(result.current.slotThemes.light, 'default');
  assert.equal(document.documentElement.dataset.theme, 'default');
  assert.ok(!document.documentElement.classList.contains('dark'));
});

test('an imported theme is applied from its own stored variables', () => {
  writeUserPreference('theme', 'dark');
  const { result } = renderHook(() => useTheme(), { wrapper });

  act(() => {
    result.current.installImportedThemes([{
      id: 'imported-test-1',
      name: 'Imported',
      appearance: 'dark',
      previewColors: ['#000000', '#111111', '#89b4fa'],
      tokens: { background: '0 0% 0%', foreground: '0 0% 100%' },
    }]);
  });
  act(() => {
    result.current.setSlotTheme('dark', 'imported-test-1');
  });

  const injected = document.getElementById('imported-color-themes');
  assert.ok(injected, 'the imported palette needs a stylesheet to live in');
  assert.match(injected.textContent ?? '', /:root\[data-theme="imported-test-1"\]/);
  assert.match(injected.textContent ?? '', /--background: 0 0% 0%;/);
  assert.equal(document.documentElement.dataset.theme, 'imported-test-1');
});

test('removing the themes a slot uses puts it back on the default', () => {
  writeUserPreference('theme', 'dark');
  const { result } = renderHook(() => useTheme(), { wrapper });

  act(() => {
    result.current.installImportedThemes([importedTheme('imported-a', 'dark'), importedTheme('imported-b', 'light')]);
  });
  act(() => {
    result.current.setSlotTheme('dark', 'imported-a');
    result.current.setSlotTheme('light', 'imported-b');
  });
  act(() => {
    result.current.removeImportedThemes(['imported-a', 'imported-b']);
  });

  assert.deepEqual(result.current.slotThemes, { light: 'default', dark: 'default' });
  assert.equal(readUserPreference('darkColorTheme', null), 'default');
  assert.equal(readUserPreference('lightColorTheme', null), 'default');
  assert.equal(document.documentElement.dataset.theme, 'default');
  assert.ok(!document.getElementById('imported-color-themes'));
});

test('a corrupted imported theme is dropped instead of crashing the first render', () => {
  // The value round-trips through the server as opaque JSON; one null in the
  // array would otherwise be read for its id before anything could recover.
  writeUserPreference('importedThemes', [
    null,
    'not a theme',
    { id: 'imported-valid', name: 'Valid', appearance: 'dark', previewColors: ['#000', '#111', '#222'], tokens: { background: '0 0% 0%' } },
    { id: 42, name: 'Bad id', appearance: 'dark', previewColors: [] },
  ]);

  const { result } = renderHook(() => useTheme(), { wrapper });

  assert.deepEqual(
    result.current.availableThemes.map((theme) => theme.id),
    ['default', 'imported-valid'],
  );
});

test('a theme id whose theme is gone falls back without erasing the stored choice', () => {
  // The shape of deleting an imported palette on another device.
  writeUserPreference('darkColorTheme', 'imported-deleted-elsewhere');

  const { result } = renderHook(() => useTheme(), { wrapper });

  assert.equal(result.current.slotThemes.dark, 'default');
  assert.equal(
    readUserPreference('darkColorTheme', null),
    'imported-deleted-elsewhere',
    'the choice stays stored in case the theme comes back',
  );
});

test('the first paint follows the OS for a user who chose "system"', () => {
  // Before the system option, any stored value other than 'dark' meant light.
  writeUserPreference('theme', 'system');
  emulateSystemDarkAppearance(true);

  applyStoredColorTheme();

  assert.ok(document.documentElement.classList.contains('dark'));
});

test('the first paint uses the slot for the mode the OS is in', () => {
  writeUserPreference('theme', 'system');
  writeUserPreference('importedThemes', [importedTheme('imported-dark', 'dark'), importedTheme('imported-light', 'light')]);
  writeUserPreference('lightColorTheme', 'imported-light');
  writeUserPreference('darkColorTheme', 'imported-dark');
  emulateSystemDarkAppearance(true);

  applyStoredColorTheme();

  assert.equal(document.documentElement.dataset.theme, 'imported-dark');
});

test('the OS switching appearance under "system" swaps to the other slot', () => {
  emulateSystemDarkAppearance(false);
  const { result } = renderHook(() => useTheme(), { wrapper });
  act(() => {
    result.current.setThemeMode('system');
    result.current.installImportedThemes([importedTheme('imported-dark', 'dark'), importedTheme('imported-light', 'light')]);
  });
  act(() => {
    result.current.setSlotTheme('light', 'imported-light');
    result.current.setSlotTheme('dark', 'imported-dark');
  });
  assert.equal(document.documentElement.dataset.theme, 'imported-light');

  act(() => {
    changeSystemAppearance(true);
  });

  assert.equal(result.current.themeMode, 'system');
  assert.equal(document.documentElement.dataset.theme, 'imported-dark');
  assert.ok(document.documentElement.classList.contains('dark'));
});

test('updating an extension keeps the slot on its variant and adds no copies', () => {
  const { result } = renderHook(() => useTheme(), { wrapper });
  const source = { extensionId: 'acme.night', version: '1.0.0' };

  let firstIds: string[] = [];
  act(() => {
    firstIds = result.current.installImportedThemes(
      [{ ...importedTheme('imported-night-old', 'dark'), name: 'Night' }, { ...importedTheme('imported-day-old', 'light'), name: 'Day' }],
      source,
    );
  });
  act(() => {
    result.current.setSlotTheme('dark', firstIds[0]);
  });

  act(() => {
    result.current.installImportedThemes(
      [{ ...importedTheme('imported-night-new', 'dark'), name: 'Night' }],
      { ...source, version: '2.0.0' },
    );
  });

  const imported = result.current.availableThemes.filter((entry) => entry.tokens);
  assert.deepEqual(imported.map((entry) => entry.id), [firstIds[0]], 'the dropped variant is gone, nothing duplicated');
  assert.equal(result.current.slotThemes.dark, firstIds[0]);
  assert.equal(imported[0].source?.version, '2.0.0');
});

test('an update that drops a slot\'s variant moves it to a kept variant of the same mode', () => {
  const { result } = renderHook(() => useTheme(), { wrapper });
  const source = { extensionId: 'acme.night', version: '1.0.0' };

  let firstIds: string[] = [];
  act(() => {
    firstIds = result.current.installImportedThemes(
      [{ ...importedTheme('a', 'dark'), name: 'Night' }, { ...importedTheme('b', 'light'), name: 'Day' }],
      source,
    );
  });
  act(() => {
    result.current.setSlotTheme('dark', firstIds[0]);
    result.current.setSlotTheme('light', firstIds[1]);
  });

  let secondIds: string[] = [];
  act(() => {
    secondIds = result.current.installImportedThemes(
      [{ ...importedTheme('c', 'dark'), name: 'Midnight' }, { ...importedTheme('d', 'light'), name: 'Dawn' }],
      source,
    );
  });

  assert.deepEqual(result.current.slotThemes, { dark: secondIds[0], light: secondIds[1] });
  assert.equal(readUserPreference('lightColorTheme', null), secondIds[1]);
});

test('an update that leaves no variant for a slot puts it back on the default', () => {
  const { result } = renderHook(() => useTheme(), { wrapper });
  const source = { extensionId: 'acme.night', version: '1.0.0' };

  let firstIds: string[] = [];
  act(() => {
    firstIds = result.current.installImportedThemes(
      [{ ...importedTheme('a', 'dark'), name: 'Night' }, { ...importedTheme('b', 'light'), name: 'Day' }],
      source,
    );
  });
  act(() => {
    result.current.setSlotTheme('light', firstIds[1]);
  });

  act(() => {
    result.current.installImportedThemes([{ ...importedTheme('c', 'dark'), name: 'Night' }], source);
  });

  assert.equal(result.current.slotThemes.light, 'default');
  assert.equal(readUserPreference('lightColorTheme', null), 'default');
});
