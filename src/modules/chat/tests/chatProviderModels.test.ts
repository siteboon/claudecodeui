import assert from 'node:assert/strict';

import { createElement } from 'react';
import type { PropsWithChildren } from 'react';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, test, vi } from 'vitest';

import { resetUserPreferences, writeUserPreference } from '@/shared/userSettings';
import { useChatProviderState } from '@/modules/chat/hooks/useChatProviderState';
import {
  OMP_CONFIGURED_MODEL_SENTINEL,
} from '@/shared/constants';

/**
 * The four per-provider default models used to be four useState slots with four
 * copy-pasted reconciliation effects and a four-branch setter. They are now one
 * Record with one loop. These tests pin the behaviour that has to survive that:
 * each provider keeps its own model, under its own storage key, and choosing a
 * model persists it.
 */

const okJson = (data: unknown) => Promise.resolve({
  ok: true,
  json: async () => data,
});

vi.mock('@/shared/api', () => ({
  api: {
    // The preference store PATCHes through api.user; it is stubbed rather than
    // exercised here, which keeps these tests about the model record.
    user: {
      preferences: () => okJson({ success: true, preferences: {} }),
      savePreferences: () => okJson({ success: true, preferences: {} }),
    },
    providers: {
      models: () => okJson({ success: true, data: null }),
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

const renderProviderState = async () => {
  const i18n = createInstance();
  await i18n.init({
    lng: 'en',
    resources: {
      en: { chat: { providerSelection: { ompDefaultModel: 'Configured model' } } },
      fr: { chat: { providerSelection: { ompDefaultModel: 'Modèle configuré' } } },
    },
  });
  const view = renderHook(
    () => useChatProviderState({ selectedSession: null, selectedProject: null }),
    { wrapper: ({ children }: PropsWithChildren) => createElement(I18nextProvider, { i18n }, children) },
  );
  return { ...view, i18n };
};

beforeEach(() => {
  localStorage.clear();
  // The preference store is a module-level singleton, so its in-memory copy
  // outlives localStorage.clear() and would leak one test's writes into the next.
  resetUserPreferences();
});


test('each provider gets its own model from its own storage key', async () => {
  localStorage.setItem('claude-model', 'claude-stored');
  localStorage.setItem('cursor-model', 'cursor-stored');
  localStorage.setItem('codex-model', 'codex-stored');
  localStorage.setItem('opencode-model', 'opencode-stored');
  localStorage.setItem('omp-model', 'omp-stored');

  const { result } = await renderProviderState();

  await waitFor(() => {
    assert.equal(result.current.providerModels.claude, 'claude-stored');
  });
  assert.equal(result.current.providerModels.cursor, 'cursor-stored');
  assert.equal(result.current.providerModels.codex, 'codex-stored');
  assert.equal(result.current.providerModels.opencode, 'opencode-stored');
  assert.equal(result.current.providerModels.omp, 'omp-stored');
});

test('a provider with no stored model falls back to its own default, not another provider’s', async () => {
  const { result } = await renderProviderState();

  await waitFor(() => {
    assert.ok(result.current.providerModels.claude);
  });

  const models = result.current.providerModels;
  assert.equal(
    new Set(Object.values(models)).size,
    Object.keys(models).length,
    'each provider must have a distinct default model',
  );
});

test('OMP fallback model follows the UI language without changing the selected model', async () => {
  writeUserPreference('selectedProvider', 'omp');
  const { result, i18n } = await renderProviderState();

  await waitFor(() => {
    assert.equal(result.current.provider, 'omp');
  });
  const englishLabel = result.current.currentProviderModelOptions[0].label;
  await act(async () => {
    await i18n.changeLanguage('fr');
  });

  assert.equal(result.current.currentProviderModel, OMP_CONFIGURED_MODEL_SENTINEL);
  assert.equal(result.current.currentProviderModelOptions[0].value, OMP_CONFIGURED_MODEL_SENTINEL);
  assert.equal(
    result.current.currentProviderModelOptions[0].label,
    i18n.t('providerSelection.ompDefaultModel', { ns: 'chat' }),
  );
  assert.notEqual(result.current.currentProviderModelOptions[0].label, englishLabel);
});

test('OMP preserves a stored effort until its dynamic model catalog loads', async () => {
  writeUserPreference('selectedProvider', 'omp');
  localStorage.setItem('omp-effort', 'high');
  const { result } = await renderProviderState();

  await waitFor(() => {
    assert.equal(result.current.provider, 'omp');
  });
  assert.equal(result.current.currentProviderEffort, 'high');
  assert.equal(localStorage.getItem('omp-effort'), 'high');
});

test('choosing a model persists it under that provider’s key only', async () => {
  const { result } = await renderProviderState();
  await waitFor(() => {
    assert.ok(result.current.providerModels.codex);
  });
  const claudeBefore = result.current.providerModels.claude;

  act(() => {
    result.current.setStoredProviderModel('codex', 'codex-chosen');
  });

  assert.equal(result.current.providerModels.codex, 'codex-chosen');
  assert.equal(localStorage.getItem('codex-model'), 'codex-chosen');
  assert.equal(
    result.current.providerModels.claude,
    claudeBefore,
    'setting one provider must not disturb another',
  );
  assert.equal(localStorage.getItem('claude-model'), null);
});

test('setting the same model twice keeps the record identity stable', async () => {
  const { result } = await renderProviderState();
  await waitFor(() => {
    assert.ok(result.current.providerModels.claude);
  });

  act(() => {
    result.current.setStoredProviderModel('claude', 'pinned');
  });
  const afterFirst = result.current.providerModels;

  act(() => {
    result.current.setStoredProviderModel('claude', 'pinned');
  });

  assert.equal(
    result.current.providerModels,
    afterFirst,
    'a no-op write must not allocate a new record and wake consumers',
  );
});

test('the active provider’s model is what currentProviderModel reports', async () => {
  // The provider selection is a stored preference; the per-provider model is
  // still a plain localStorage key.
  writeUserPreference('selectedProvider', 'cursor');
  localStorage.setItem('cursor-model', 'cursor-active');

  const { result } = await renderProviderState();

  await waitFor(() => {
    assert.equal(result.current.provider, 'cursor');
  });
  assert.equal(result.current.currentProviderModel, 'cursor-active');
});
