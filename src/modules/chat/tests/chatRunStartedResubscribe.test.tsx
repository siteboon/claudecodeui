import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import { describe, it, vi } from 'vitest';

import { useChatRealtimeHandlers } from '@/modules/chat/hooks/useChatRealtimeHandlers';
import type { SessionStore } from '@/modules/chat/hooks/useSessionStore';
import type { ProjectSession, ServerEvent } from '@/shared/types';

/**
 * A run the server starts on its own (the dispatcher's queued turn, a
 * scheduled message) registers its writer with no audience. The page only
 * receives that run's stream if it subscribes while the run is live, so
 * `chat_run_started` has to make the visible session subscribe again —
 * otherwise the turn is transcribed but never painted until a reload.
 */

const renderHandlers = (resubscribed: string[], processing: string[]) => {
  let listener: ((event: ServerEvent) => void) | null = null;

  renderHook(() => useChatRealtimeHandlers({
    isActive: true,
    subscribe: (fn) => {
      listener = fn;
      return () => { listener = null; };
    },
    provider: 'claude',
    selectedSession: { id: 'viewed-session' } as ProjectSession,
    currentSessionId: 'viewed-session',
    setTokenBudget: () => {},
    pendingPermissionRequests: [],
    setPendingPermissionRequests: () => {},
    streamTimerRef: { current: null },
    accumulatedStreamRef: { current: '' },
    lastSeqRef: { current: new Map() },
    statusCheckSentAtRef: { current: new Map() },
    onSessionProcessing: (sessionId) => { if (sessionId) processing.push(sessionId); },
    onSessionIdle: () => {},
    onSessionBackground: () => {},
    getSessionActivity: () => undefined,
    requestResubscribe: (sessionId) => { resubscribed.push(sessionId); },
    requestLatestMessages: async () => {},
    sessionStore: {
      appendRealtime: () => {},
      getMessages: () => [],
      updateStreaming: () => {},
      finalizeStreaming: () => {},
    } as unknown as SessionStore,
  }));

  const dispatch = (event: ServerEvent) => {
    act(() => { listener?.(event); });
  };
  return { dispatch };
};

const runStarted = (sessionId: string): ServerEvent => ({
  kind: 'chat_run_started',
  sessionId,
} as ServerEvent);

describe('chat_run_started', () => {
  it('subscribes the visible session to the run that started without it', () => {
    const resubscribed: string[] = [];
    const processing: string[] = [];
    const { dispatch } = renderHandlers(resubscribed, processing);

    dispatch(runStarted('viewed-session'));

    assert.deepEqual(processing, ['viewed-session']);
    assert.deepEqual(resubscribed, ['viewed-session']);
  });

  it('leaves a run in another session alone: this page is not showing it', () => {
    const resubscribed: string[] = [];
    const processing: string[] = [];
    const { dispatch } = renderHandlers(resubscribed, processing);

    dispatch(runStarted('other-session'));

    assert.deepEqual(processing, ['other-session']);
    assert.deepEqual(resubscribed, []);
  });
});
