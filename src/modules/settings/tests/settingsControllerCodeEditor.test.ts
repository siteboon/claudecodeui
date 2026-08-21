import assert from 'node:assert/strict';

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import { CODE_EDITOR_STORAGE_KEYS } from '@/shared/constants';

/**
 * The regression was in useSettingsController itself: an effect keyed on the
 * settings object wrote all four codeEditor* keys, and it ran on mount. Opening
 * the dialog on any tab therefore materialized the settings module's own
 * defaults over the editor's, changing the font size of anyone who had never set
 * one. Testing the storage helpers alone cannot catch that, so this drives the
 * hook.
 */

vi.mock('@/shared/api', () => ({
  api: {
    settings: {
      notificationPreferences: () => Promise.resolve({ ok: false }),
      saveNotificationPreferences: () => Promise.resolve({ ok: true, json: async () => ({}) }),
    },
  },
}));

// These mocks must return stable identities: the hook's open-effect depends on
// the functions they expose, so fresh ones each render would re-run it forever.
vi.mock('@/shared/context/ThemeContext', () => {
  const theme = { isDarkMode: false, toggleDarkMode: () => undefined };
  return { useTheme: () => theme };
});

vi.mock('@/modules/provider-auth', () => {
  const authStatus = {
    providerAuthStatus: {},
    checkProviderAuthStatus: () => Promise.resolve({ authenticated: false }),
    refreshProviderAuthStatuses: () => Promise.resolve(),
  };
  return { useProviderAuthStatus: () => authStatus };
});

const renderSettings = async () => {
  const { useSettingsController } = await import(
    '@/modules/settings/hooks/useSettingsController'
  );
  return renderHook(() => useSettingsController({ isOpen: true, initialTab: 'appearance' }));
};

const codeEditorKeysInStorage = () =>
  Object.values(CODE_EDITOR_STORAGE_KEYS).filter((key) => localStorage.getItem(key) !== null);

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.resetModules();
});

test('opening settings writes no code-editor key for a user who never set one', async () => {
  const { result } = await renderSettings();

  await waitFor(() => {
    assert.ok(result.current.codeEditorSettings);
  });

  assert.deepEqual(
    codeEditorKeysInStorage(),
    [],
    'merely opening the dialog must not materialize code-editor defaults',
  );
});

test('opening settings does not change a font size the user already chose', async () => {
  localStorage.setItem(CODE_EDITOR_STORAGE_KEYS.fontSize, '12');

  const { result } = await renderSettings();
  await waitFor(() => {
    assert.equal(result.current.codeEditorSettings.fontSize, '12');
  });

  assert.equal(localStorage.getItem(CODE_EDITOR_STORAGE_KEYS.fontSize), '12');
});

test('changing a setting writes all four keys and notifies the editor once', async () => {
  const { result } = await renderSettings();
  await waitFor(() => {
    assert.ok(result.current.updateCodeEditorSetting);
  });

  let notifications = 0;
  const onChanged = () => {
    notifications += 1;
  };
  window.addEventListener('codeEditorSettingsChanged', onChanged);

  act(() => {
    result.current.updateCodeEditorSetting('fontSize', '18');
  });

  window.removeEventListener('codeEditorSettingsChanged', onChanged);

  assert.equal(localStorage.getItem(CODE_EDITOR_STORAGE_KEYS.fontSize), '18');
  assert.equal(codeEditorKeysInStorage().length, 4, 'all four keys are written together');
  assert.equal(notifications, 1);
  assert.equal(result.current.codeEditorSettings.fontSize, '18');
});

test('a second change keeps the earlier one', async () => {
  const { result } = await renderSettings();
  await waitFor(() => {
    assert.ok(result.current.updateCodeEditorSetting);
  });

  act(() => {
    result.current.updateCodeEditorSetting('fontSize', '18');
  });
  act(() => {
    result.current.updateCodeEditorSetting('wordWrap', true);
  });

  assert.equal(localStorage.getItem(CODE_EDITOR_STORAGE_KEYS.fontSize), '18');
  assert.equal(localStorage.getItem(CODE_EDITOR_STORAGE_KEYS.wordWrap), 'true');
});

test('two edits in one batch both survive', async () => {
  // The merge base is storage, not the rendered state, so the second call in a
  // batch cannot write a pre-first-edit snapshot back over the first.
  const { result } = await renderSettings();

  act(() => {
    result.current.updateCodeEditorSetting('fontSize', '20');
    result.current.updateCodeEditorSetting('wordWrap', true);
  });

  await waitFor(() => {
    assert.equal(localStorage.getItem(CODE_EDITOR_STORAGE_KEYS.fontSize), '20');
  });
  assert.equal(localStorage.getItem(CODE_EDITOR_STORAGE_KEYS.wordWrap), 'true');
  assert.equal(result.current.codeEditorSettings.fontSize, '20');
  assert.equal(result.current.codeEditorSettings.wordWrap, true);
});
