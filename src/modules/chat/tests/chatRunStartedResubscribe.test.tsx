import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import { describe, it, vi } from 'vitest';

import { useChatRealtimeHandlers } from '@/modules/chat/hooks/useChatRealtimeHandlers';
import type { SessionStore } from '@/modules/chat/hooks/useSessionStore';
import { useSessionProtection } from '@/shared/hooks/useSessionProtection';
import type { ProjectSession, ServerEvent } from '@/shared/types';

/**
 * A run the server starts on its own (the dispatcher's queued turn, a
 * scheduled message) registers its writer with no audience. The page only
 * receives that run's stream if it subscribes while the run is live, so
 * `chat_run_started` has to make the visible session subscribe again —
 * otherwise the turn is transcribed but never painted until a reload.
 */

type HarnessOptions = {
  initialLastSeq?: Array<[string, number]>;
  markSubscribeSent?: boolean;
};

const renderHandlers = (options: HarnessOptions = {}) => {
  let listener: ((event: ServerEvent) => void) | null = null;
  const resubscribed: Array<{ sessionId: string; lastSeq: number }> = [];
  const processing: string[] = [];
  const reloads: Array<{ sessionId: string; allowNetwork?: boolean }> = [];
  const streamed: string[] = [];
  const lastSeqRef = { current: new Map<string, number>(options.initialLastSeq) };
  const statusCheckSentAtRef = { current: new Map<string, number>() };
  const lastRunIdRef = { current: new Map<string, string>() };
  const streamTimerRef = { current: null as number | null };
  const accumulatedStreamRef = { current: '' };

  const hook = renderHook(() => {
    const protection = useSessionProtection();
    useChatRealtimeHandlers({
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
      streamTimerRef,
      accumulatedStreamRef,
      lastSeqRef,
      lastRunIdRef,
      statusCheckSentAtRef,
      onSessionProcessing: (sessionId, activity) => {
        if (sessionId) processing.push(sessionId);
        protection.markSessionProcessing(sessionId, activity);
      },
      onSessionIdle: (sessionId, opts) => {
        protection.markSessionIdle(sessionId, opts);
      },
      onSessionBackground: () => {},
      getSessionActivity: protection.getSessionActivity,
      requestResubscribe: (sessionId) => {
        if (options.markSubscribeSent) {
          statusCheckSentAtRef.current.set(sessionId, Date.now());
        }
        resubscribed.push({ sessionId, lastSeq: lastSeqRef.current.get(sessionId) ?? 0 });
      },
      requestLatestMessages: async (sessionId, allowNetwork) => {
        reloads.push({ sessionId, allowNetwork });
      },
      sessionStore: {
        appendRealtime: () => {},
        getMessages: () => [],
        updateStreaming: (_sid: string, text: string) => { streamed.push(text); },
        finalizeStreaming: () => {},
      } as unknown as SessionStore,
    });
    return { processingSessions: protection.processingSessions };
  });

  const dispatch = (event: ServerEvent) => {
    act(() => { listener?.(event); });
  };
  return { dispatch, resubscribed, processing, reloads, streamed, lastSeqRef, hook };
};

const runStarted = (sessionId: string): ServerEvent => ({
  kind: 'chat_run_started',
  sessionId,
} as ServerEvent);

describe('chat_run_started', () => {
  it('subscribes the visible session to the run that started without it', () => {
    const { dispatch, resubscribed, processing } = renderHandlers();

    dispatch(runStarted('viewed-session'));

    assert.deepEqual(processing, ['viewed-session']);
    assert.deepEqual(resubscribed.map((entry) => entry.sessionId), ['viewed-session']);
  });

  it('leaves a run in another session alone: this page is not showing it', () => {
    const { dispatch, resubscribed, processing } = renderHandlers();

    dispatch(runStarted('other-session'));

    assert.deepEqual(processing, ['other-session']);
    assert.deepEqual(resubscribed, []);
  });

  it('reloads the transcript and clears processing when an idle ack answers a post-run-start subscribe', () => {
    const { dispatch, reloads, hook } = renderHandlers({ markSubscribeSent: true });

    dispatch(runStarted('viewed-session'));
    assert.equal(hook.result.current.processingSessions.has('viewed-session'), true);

    dispatch({
      kind: 'chat_subscribed',
      sessionId: 'viewed-session',
      isProcessing: false,
      pendingPermissions: [],
    } as unknown as ServerEvent);

    assert.equal(hook.result.current.processingSessions.has('viewed-session'), false);
    assert.deepEqual(reloads, [{ sessionId: 'viewed-session', allowNetwork: true }]);
  });

  it('does not reload on an ordinary idle ack or when the resubscribed run is still processing', () => {
    const { dispatch, reloads } = renderHandlers({ markSubscribeSent: true });

    dispatch({
      kind: 'chat_subscribed',
      sessionId: 'viewed-session',
      isProcessing: false,
      pendingPermissions: [],
    } as unknown as ServerEvent);
    assert.deepEqual(reloads, []);

    dispatch(runStarted('viewed-session'));
    dispatch({
      kind: 'chat_subscribed',
      sessionId: 'viewed-session',
      isProcessing: true,
      pendingPermissions: [],
    } as unknown as ServerEvent);
    assert.deepEqual(reloads, []);
  });

  it('resets the prior run cursor on chat_run_started while keeping the current run cursor', () => {
    const { dispatch, resubscribed, lastSeqRef } = renderHandlers({
      initialLastSeq: [['viewed-session', 100]],
    });

    dispatch(runStarted('viewed-session'));
    assert.deepEqual(resubscribed, [{ sessionId: 'viewed-session', lastSeq: 0 }]);

    dispatch({
      kind: 'stream_delta',
      sessionId: 'viewed-session',
      content: 'first',
      seq: 1,
    } as unknown as ServerEvent);
    dispatch({
      kind: 'stream_delta',
      sessionId: 'viewed-session',
      content: ' second',
      seq: 2,
    } as unknown as ServerEvent);

    assert.equal(lastSeqRef.current.get('viewed-session'), 2);
  });

  it('补读断线期间已结束而没有看到开始通知的轮次', () => {
    const { dispatch, reloads } = renderHandlers();
    dispatch({ kind: 'chat_subscribed', sessionId: 'viewed-session', isProcessing: false, runId: 'completed-run' });
    assert.deepEqual(reloads, [{ sessionId: 'viewed-session', allowNetwork: true }]);
  });

  it('接受断线期间启动的新轮回放，即使新轮序号已经超过旧游标', () => {
    const { dispatch, lastSeqRef, resubscribed } = renderHandlers({
      initialLastSeq: [['viewed-session', 10]],
    });
    dispatch({ kind: 'chat_subscribed', sessionId: 'viewed-session', runId: 'new-run', isProcessing: true, lastSeq: 15 });
    dispatch({ kind: 'stream_delta', sessionId: 'viewed-session', runId: 'new-run', seq: 1, content: '开头' });

    assert.equal(lastSeqRef.current.get('viewed-session'), 1);
    assert.deepEqual(resubscribed, []);
  });

  it('drops duplicate replayed deltas within the same run while still playing detached replays', () => {
    vi.useFakeTimers();
    try {
      const { dispatch, streamed } = renderHandlers();

      dispatch(runStarted('viewed-session'));
      // Live frame arrives before the replay for seq 1 lands.
      dispatch({
        kind: 'stream_delta',
        sessionId: 'viewed-session',
        content: 'Hi',
        seq: 1,
      } as unknown as ServerEvent);
      dispatch({
        kind: 'chat_subscribed',
        sessionId: 'viewed-session',
        isProcessing: true,
        pendingPermissions: [],
      } as unknown as ServerEvent);
      dispatch({
        kind: 'stream_delta',
        sessionId: 'viewed-session',
        content: 'Hi',
        seq: 1,
      } as unknown as ServerEvent);
      dispatch({
        kind: 'stream_delta',
        sessionId: 'viewed-session',
        content: '!',
        seq: 2,
      } as unknown as ServerEvent);

      act(() => { vi.advanceTimersByTime(150); });
      assert.deepEqual(streamed, ['Hi!']);
    } finally {
      vi.useRealTimers();
    }
  });
});
