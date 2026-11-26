import assert from 'node:assert/strict';

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import type * as UserSettingsModule from '@/shared/userSettings';

/**
 * New chats used to start from `default` (no explicit effort) regardless of
 * what the user configured, because the composer only remembered the last
 * manual pick. These tests pin the settings-page defaults taking precedence
 * for a session-less composer, while an unset default keeps the old behaviour.
 *
 * The preference store re-exports through a dynamic import so the test and the
 * hook share one module instance: `vi.resetModules()` gives each test a fresh
 * store, and the static test import would otherwise point at the previous one.
 */

const okJson = (data: unknown) => Promise.resolve({
  ok: true,
  json: async () => data,
});

const CATALOG = {
  success: true,
  data: {
    models: {
      OPTIONS: [
        {
          value: 'default',
          label: 'Default',
          effort: {
            default: 'high',
            values: [{ value: 'low' }, { value: 'medium' }, { value: 'high' }, { value: 'max' }],
          },
        },
        {
          value: 'best',
          label: 'Best',
          effort: {
            default: 'high',
            values: [{ value: 'low' }, { value: 'medium' }, { value: 'high' }, { value: 'max' }],
          },
        },
      ],
      DEFAULT: 'default',
    },
  },
};

vi.mock('@/shared/api', () => ({
  api: {
    user: {
      preferences: () => okJson({ success: true, preferences: {} }),
      savePreferences: () => okJson({ success: true, preferences: {} }),
    },
    providers: {
      models: () => okJson(CATALOG),
      capabilities: () => okJson({ success: true, data: null }),
      sessionActiveModel: () => okJson({ success: true, data: null }),
      setSessionActiveModel: () => okJson({ success: true, data: null }),
      setSessionActiveEffort: () => okJson({ success: true, data: null }),
      createModel: () => okJson({ success: true, data: null }),
      updateModel: () => okJson({ success: true, data: null }),
      removeModel: () => okJson({ success: true, data: null }),
    },
  },
}));

let userSettings: typeof UserSettingsModule;

beforeEach(async () => {
  localStorage.clear();
  userSettings = await import('@/shared/userSettings');
  userSettings.resetUserPreferences();
});

afterEach(() => {
  vi.resetModules();
});

const renderProviderState = async () => {
  const { useChatProviderState } = await import(
    '@/modules/chat/hooks/useChatProviderState'
  );
  return renderHook(() =>
    useChatProviderState({ selectedSession: null, selectedProject: null }),
  );
};

test('a new chat starts from the saved model and effort defaults', async () => {
  userSettings.writeUserPreference('chatDefaults', {
    claude: { model: 'best', effort: 'max' },
  });

  const { result } = await renderProviderState();

  await waitFor(() => {
    assert.equal(result.current.providerModels.claude, 'best');
    assert.equal(result.current.currentProviderEffort, 'max');
  });
});

test('the saved default wins over the last manual pick', async () => {
  localStorage.setItem('claude-model', 'default');
  localStorage.setItem('claude-effort', 'low');
  userSettings.writeUserPreference('chatDefaults', {
    claude: { model: 'best', effort: 'max' },
  });

  const { result } = await renderProviderState();

  await waitFor(() => {
    assert.equal(result.current.providerModels.claude, 'best');
    assert.equal(result.current.currentProviderEffort, 'max');
  });
});

test('changing the saved defaults updates a blank composer', async () => {
  userSettings.writeUserPreference('chatDefaults', { claude: { effort: 'low' } });

  const { result } = await renderProviderState();
  await waitFor(() => {
    assert.equal(result.current.currentProviderEffort, 'low');
  });

  act(() => {
    userSettings.writeUserPreference('chatDefaults', { claude: { effort: 'max' } });
  });

  await waitFor(() => {
    assert.equal(result.current.currentProviderEffort, 'max');
  });
});

test('without saved defaults the composer keeps its previous behaviour', async () => {
  localStorage.setItem('claude-effort', 'medium');

  const { result } = await renderProviderState();

  await waitFor(() => {
    assert.equal(result.current.currentProviderEffort, 'medium');
  });
});
