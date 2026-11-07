import assert from 'node:assert/strict';

import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import { resetUserPreferences } from '@/shared/userSettings';
import type { LLMProvider, ProviderModelsDefinition } from '@/shared/types';

/**
 * A saved speed tier has to survive until the provider's model catalog arrives,
 * and a catalog request that fails: until then the composer cannot tell which
 * tiers the model offers, and the server only applies a tier the model lists.
 */

const CLAUDE_CATALOG: ProviderModelsDefinition = {
  OPTIONS: [
    { value: 'opus', label: 'Opus', speed: { values: [{ value: 'fast', label: 'Fast' }] } },
    { value: 'sonnet', label: 'Sonnet' },
  ],
  DEFAULT: 'opus',
};

const okJson = (data: unknown) => Promise.resolve({
  ok: true,
  json: async () => data,
});

const catalogRequests = vi.hoisted(() => ({
  claude: null as null | (() => Promise<unknown>),
}));

vi.mock('@/shared/api', () => ({
  api: {
    user: {
      preferences: () => okJson({ success: true, preferences: {} }),
      savePreferences: () => okJson({ success: true, preferences: {} }),
    },
    providers: {
      models: (provider: LLMProvider) => (
        provider === 'claude' && catalogRequests.claude
          ? catalogRequests.claude()
          : okJson({ success: true, data: null })
      ),
      capabilities: () => okJson({ success: true, data: null }),
      sessionActiveModel: () => okJson({ success: true, data: null }),
      setSessionActiveModel: () => okJson({ success: true, data: null }),
      setSessionActiveEffort: () => okJson({ success: true, data: null }),
    },
  },
}));

const renderProviderState = async () => {
  const { useChatProviderState } = await import('@/modules/chat/hooks/useChatProviderState');
  return renderHook(() => useChatProviderState({ selectedSession: null, selectedProject: null }));
};

beforeEach(() => {
  localStorage.clear();
  resetUserPreferences();
  localStorage.setItem('claude-speed', 'fast');
});

afterEach(() => {
  catalogRequests.claude = null;
  vi.resetModules();
});

test('keeps the saved tier while the catalog loads, then keeps it for a model that offers it', async () => {
  localStorage.setItem('claude-model', 'opus');
  let answer: (value: unknown) => void = () => {};
  catalogRequests.claude = () => new Promise((resolve) => {
    answer = resolve;
  });

  const { result } = await renderProviderState();
  assert.equal(result.current.providerModelsLoading, true);
  assert.equal(result.current.currentProviderSpeed, 'fast');

  answer({ ok: true, json: async () => ({ success: true, data: { models: CLAUDE_CATALOG } }) });
  await waitFor(() => assert.equal(result.current.providerModelsLoading, false));
  assert.equal(result.current.currentProviderSpeed, 'fast');
});

test('falls back to Standard once the catalog shows the model has no such tier', async () => {
  localStorage.setItem('claude-model', 'sonnet');
  catalogRequests.claude = () => okJson({ success: true, data: { models: CLAUDE_CATALOG } });

  const { result } = await renderProviderState();
  await waitFor(() => assert.equal(result.current.providerModelsLoading, false));
  assert.equal(result.current.currentProviderSpeed, 'default');
  assert.equal(localStorage.getItem('claude-speed'), 'fast', 'the stored choice is not forgotten');
});

test('keeps the saved tier when the catalog request fails', async () => {
  localStorage.setItem('claude-model', 'opus');
  catalogRequests.claude = () => Promise.reject(new Error('offline'));
  vi.spyOn(console, 'error').mockImplementation(() => {});

  const { result } = await renderProviderState();
  await waitFor(() => assert.equal(result.current.providerModelsLoading, false));
  assert.equal(result.current.currentProviderSpeed, 'fast');
});
