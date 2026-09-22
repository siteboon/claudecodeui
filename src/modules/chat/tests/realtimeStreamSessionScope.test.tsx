import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import { afterEach, test, vi } from 'vitest';

import { useChatRealtimeHandlers } from '@/modules/chat/hooks/useChatRealtimeHandlers';
import type { ProjectSession, ServerEvent } from '@/shared/types';
import type { SessionStore } from '@/modules/chat/hooks/useSessionStore';

afterEach(() => {
  vi.useRealTimers();
});

test('keeps an off-screen stream as one message when the viewed session changes', () => {
  vi.useFakeTimers();

  let listener: ((event: ServerEvent) => void) | null = null;
  const appendRealtime = vi.fn();
  const updateStreaming = vi.fn();
  const finalizeStreaming = vi.fn();
  const sessionStore = {
    appendRealtime,
    updateStreaming,
    finalizeStreaming,
  } as unknown as SessionStore;

  const { rerender } = renderHook(
    ({ viewedSessionId }) => useChatRealtimeHandlers({
      isActive: true,
      subscribe: (fn) => {
        listener = fn;
        return () => { listener = null; };
      },
      provider: 'antigravity',
      selectedSession: { id: viewedSessionId } as ProjectSession,
      currentSessionId: viewedSessionId,
      setTokenBudget: () => {},
      pendingPermissionRequests: [],
      setPendingPermissionRequests: () => {},
      lastSeqRef: { current: new Map() },
      statusCheckSentAtRef: { current: new Map() },
      requestLatestMessages: async () => {},
      sessionStore,
    }),
    { initialProps: { viewedSessionId: 'session-a' } },
  );

  act(() => {
    listener?.({
      kind: 'stream_delta',
      sessionId: 'session-a',
      provider: 'antigravity',
      content: '권리산정',
    } as ServerEvent);
  });

  rerender({ viewedSessionId: 'session-b' });

  act(() => {
    listener?.({
      kind: 'stream_delta',
      sessionId: 'session-a',
      provider: 'antigravity',
      content: '기준일',
    } as ServerEvent);
    vi.advanceTimersByTime(100);
  });

  assert.equal(appendRealtime.mock.calls.length, 0);
  assert.deepEqual(updateStreaming.mock.calls.at(-1), [
    'session-a',
    '권리산정기준일',
    'antigravity',
  ]);

  act(() => {
    listener?.({
      kind: 'complete',
      sessionId: 'session-a',
      provider: 'antigravity',
      success: false,
    } as ServerEvent);
  });

  assert.deepEqual(updateStreaming.mock.calls.at(-1), [
    'session-a',
    '권리산정기준일',
    'antigravity',
  ]);
  assert.deepEqual(finalizeStreaming.mock.calls, [['session-a']]);
});

test('buffers concurrent streams independently by session', () => {
  vi.useFakeTimers();

  let listener: ((event: ServerEvent) => void) | null = null;
  const updateStreaming = vi.fn();
  const sessionStore = {
    appendRealtime: vi.fn(),
    updateStreaming,
    finalizeStreaming: vi.fn(),
  } as unknown as SessionStore;

  renderHook(() => useChatRealtimeHandlers({
    isActive: true,
    subscribe: (fn) => {
      listener = fn;
      return () => { listener = null; };
    },
    provider: 'antigravity',
    selectedSession: { id: 'session-a' } as ProjectSession,
    currentSessionId: 'session-a',
    setTokenBudget: () => {},
    pendingPermissionRequests: [],
    setPendingPermissionRequests: () => {},
    lastSeqRef: { current: new Map() },
    statusCheckSentAtRef: { current: new Map() },
    requestLatestMessages: async () => {},
    sessionStore,
  }));

  act(() => {
    listener?.({
      kind: 'stream_delta',
      sessionId: 'session-a',
      provider: 'antigravity',
      content: 'alpha',
    } as ServerEvent);
    listener?.({
      kind: 'stream_delta',
      sessionId: 'session-b',
      provider: 'claude',
      content: 'beta',
    } as ServerEvent);
    vi.advanceTimersByTime(100);
  });

  assert.deepEqual(updateStreaming.mock.calls, [
    ['session-a', 'alpha', 'antigravity'],
    ['session-b', 'beta', 'claude'],
  ]);
});
