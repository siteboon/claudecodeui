import assert from 'node:assert/strict';

import { renderHook } from '@testing-library/react';
import { test } from 'vitest';

import { useChatRealtimeHandlers } from '@/modules/chat/hooks/useChatRealtimeHandlers';
import type { ServerEvent, ProjectSession } from '@/shared/types';
import type { SessionStore } from '@/modules/chat/hooks/useSessionStore';

/**
 * `protocol_error` with `RUN_IN_PROGRESS`/`STEER_UNSUPPORTED` must route to
 * `onSteerRejected` (silent re-queue) only when the error actually answers a
 * `chat.steer` — not merely because a steer happens to be pending for the
 * session. Without the `requestType` check, an ordinary `chat.send` rejected
 * with `RUN_IN_PROGRESS` while a `chat.steer` awaits its `chat_steered` ack
 * was misrouted as the steer's own rejection, silently re-queuing text for a
 * steer that the server actually accepted — a later duplicate send.
 */

const renderHandlers = () => {
  let listener: ((event: ServerEvent) => void) | null = null;
  const steerRejectedCalls: Array<{ sessionId: string; code?: string }> = [];
  const idleCalls: Array<string | null | undefined> = [];

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
    // A pending steer is present for the session in both cases below (the
    // real bug used exactly this — "a steer is pending" — as its
    // correlation), so returning `true` here proves the routing decision
    // itself, not the presence of a pending steer.
    onSteerRejected: (sessionId, code) => {
      steerRejectedCalls.push({ sessionId, code });
      return true;
    },
    onSessionIdle: (sessionId) => { idleCalls.push(sessionId); },
    requestLatestMessages: async () => {},
    sessionStore: { appendRealtime: () => {} } as unknown as SessionStore,
  }));

  const dispatch = (event: ServerEvent) => listener?.(event);
  return { dispatch, steerRejectedCalls, idleCalls };
};

test('a chat.send RUN_IN_PROGRESS does not re-queue as a steer rejection (proof)', () => {
  const { dispatch, steerRejectedCalls, idleCalls } = renderHandlers();

  dispatch({
    kind: 'protocol_error',
    code: 'RUN_IN_PROGRESS',
    error: 'Session already has a run in progress.',
    sessionId: 'viewed-session',
    requestType: 'chat.send',
  } as unknown as ServerEvent);

  assert.equal(steerRejectedCalls.length, 0, 'onSteerRejected must not be called for a chat.send rejection');
  assert.deepEqual(idleCalls, ['viewed-session'], 'falls through to the ordinary error path instead');
});

test('a chat.steer RUN_IN_PROGRESS still re-queues (negative control — existing behaviour kept)', () => {
  const { dispatch, steerRejectedCalls, idleCalls } = renderHandlers();

  dispatch({
    kind: 'protocol_error',
    code: 'RUN_IN_PROGRESS',
    error: 'Session already has a run in progress.',
    sessionId: 'viewed-session',
    requestType: 'chat.steer',
  } as unknown as ServerEvent);

  assert.deepEqual(steerRejectedCalls, [{ sessionId: 'viewed-session', code: 'RUN_IN_PROGRESS' }]);
  assert.equal(idleCalls.length, 0, 'consumed by the steer path, so the ordinary error path never runs');
});
