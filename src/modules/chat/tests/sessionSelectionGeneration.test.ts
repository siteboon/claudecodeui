import assert from 'node:assert/strict';

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, test, vi } from 'vitest';

import { useChatProviderState } from '@/modules/chat/hooks/useChatProviderState';
import { api } from '@/shared/api';
import type { LLMProvider } from '@/shared/types';
import { resetUserPreferences } from '@/shared/userSettings';

const okJson = (data: unknown) => new Response(JSON.stringify(data), {
  status: 200,
  headers: { 'Content-Type': 'application/json' },
});

vi.mock('@/shared/api', () => ({
  api: {
    user: {
      preferences: async () => okJson({ success: true, preferences: {} }),
      savePreferences: async () => okJson({ success: true, preferences: {} }),
    },
    providers: {
      models: async () => okJson({ success: true, data: null }),
      capabilities: async () => okJson({ success: true, data: null }),
      sessionActiveModel: vi.fn(),
      setSessionActiveModel: vi.fn(),
      setSessionActiveEffort: vi.fn(),
    },
  },
}));

const sessionResponse = (model: string, effort: string) => okJson({
  success: true,
  data: { model, effort, source: 'session' },
});

const deferredResponse = () => {
  let resolveResponse: ((response: Response) => void) | undefined;
  const promise = new Promise<Response>((resolve) => { resolveResponse = resolve; });
  return {
    promise,
    resolve(model: string, effort: string) {
      assert.ok(resolveResponse);
      resolveResponse(sessionResponse(model, effort));
    },
  };
};

const renderSession = (provider: LLMProvider) => renderHook(
  ({ sessionId }) => useChatProviderState({
    selectedSession: { id: sessionId, __provider: provider },
    selectedProject: null,
  }),
  { initialProps: { sessionId: 'session-a' } },
);

beforeEach(() => {
  localStorage.clear();
  resetUserPreferences();
  vi.resetAllMocks();
});

test('returning to a Claude session ignores a model mutation from its earlier visit', async () => {
  vi.mocked(api.providers.sessionActiveModel)
    .mockResolvedValueOnce(sessionResponse('sonnet', 'low'))
    .mockResolvedValueOnce(sessionResponse('sonnet', 'medium'))
    .mockResolvedValueOnce(sessionResponse('haiku', 'high'));
  const staleModel = deferredResponse();
  vi.mocked(api.providers.setSessionActiveModel).mockReturnValueOnce(staleModel.promise);
  const { result, rerender } = renderSession('claude');
  await waitFor(() => assert.equal(result.current.currentProviderModel, 'sonnet'));

  let mutation: Promise<unknown>;
  act(() => {
    mutation = result.current.selectProviderModel('claude', 'opus', 'session-a');
  });

  // Keep the hook mounted, as ChatInterface does during session navigation.
  rerender({ sessionId: 'session-b' });
  await waitFor(() => assert.equal(result.current.currentProviderEffort, 'medium'));
  rerender({ sessionId: 'session-a' });
  await waitFor(() => {
    assert.equal(result.current.currentProviderModel, 'haiku');
    assert.equal(result.current.currentProviderEffort, 'high');
  });

  await act(async () => {
    staleModel.resolve('opus', 'max');
    await mutation;
  });
  assert.equal(result.current.currentProviderModel, 'haiku');
  assert.equal(result.current.currentProviderEffort, 'high');
});

test('returning to a Codex session ignores an effort mutation from its earlier visit', async () => {
  vi.mocked(api.providers.sessionActiveModel)
    .mockResolvedValueOnce(sessionResponse('gpt-5.3-codex', 'low'))
    .mockResolvedValueOnce(sessionResponse('gpt-5.3-codex', 'medium'))
    .mockResolvedValueOnce(sessionResponse('gpt-5.4', 'high'));
  const staleEffort = deferredResponse();
  vi.mocked(api.providers.setSessionActiveEffort).mockReturnValueOnce(staleEffort.promise);
  const { result, rerender } = renderSession('codex');
  await waitFor(() => assert.equal(result.current.currentProviderEffort, 'low'));

  let mutation: Promise<unknown>;
  act(() => {
    mutation = result.current.selectProviderEffort('codex', 'xhigh', 'session-a');
  });

  rerender({ sessionId: 'session-b' });
  await waitFor(() => assert.equal(result.current.currentProviderEffort, 'medium'));
  rerender({ sessionId: 'session-a' });
  await waitFor(() => {
    assert.equal(result.current.currentProviderModel, 'gpt-5.4');
    assert.equal(result.current.currentProviderEffort, 'high');
  });

  await act(async () => {
    staleEffort.resolve('gpt-5.3-codex', 'xhigh');
    await mutation;
  });
  assert.equal(result.current.currentProviderModel, 'gpt-5.4');
  assert.equal(result.current.currentProviderEffort, 'high');
});

test('model and effort responses still apply while the session stays open', async () => {
  vi.mocked(api.providers.sessionActiveModel)
    .mockResolvedValueOnce(sessionResponse('sonnet', 'low'));
  vi.mocked(api.providers.setSessionActiveModel)
    .mockResolvedValueOnce(sessionResponse('opus', 'low'));
  vi.mocked(api.providers.setSessionActiveEffort)
    .mockResolvedValueOnce(sessionResponse('opus', 'high'));
  const { result } = renderSession('claude');
  await waitFor(() => assert.equal(result.current.currentProviderModel, 'sonnet'));

  await act(async () => {
    await result.current.selectProviderModel('claude', 'opus', 'session-a');
  });
  assert.equal(result.current.currentProviderModel, 'opus');

  await act(async () => {
    await result.current.selectProviderEffort('claude', 'max', 'session-a');
  });
  // The persisted response, not the optimistic choice, becomes observable.
  assert.equal(result.current.currentProviderEffort, 'high');
  assert.equal(result.current.currentProviderModel, 'opus');
});
