import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import { beforeEach, test } from 'vitest';

import { useChatRealtimeHandlers } from '@/modules/chat/hooks/useChatRealtimeHandlers';
import { useSessionStore } from '@/modules/chat/hooks/useSessionStore';
import {
  getServerClockOffsetMs,
  recordServerClockSample,
  resetServerClockOffsetForTests,
} from '@/shared/serverClock';
import type { NormalizedMessage, ProjectSession, ServerEvent } from '@/shared/types';
import type { SessionStore } from '@/modules/chat/hooks/useSessionStore';

/**
 * serverClock.test.ts covers the estimator. This covers the wiring: that the
 * `chat_subscribed` ack is what feeds it, and that the rows this PR is about
 * are actually stamped through it. Without these, reverting a call site to
 * `new Date().toISOString()` leaves the whole suite green and the duplicate
 * bubble back.
 */

const SKEW_MS = 45_000;

const renderHandlers = (statusCheckSentAt: Map<string, number>) => {
  let listener: ((event: ServerEvent) => void) | null = null;
  const appended: NormalizedMessage[] = [];

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
    statusCheckSentAtRef: { current: statusCheckSentAt },
    requestLatestMessages: async () => {},
    sessionStore: {
      appendRealtime: (_sessionId: string, message: NormalizedMessage) => { appended.push(message); },
    } as unknown as SessionStore,
  }));

  return { dispatch: (event: ServerEvent) => listener?.(event), appended };
};

/** The ack the server sends, stamped by a server clock `SKEW_MS` behind us. */
const subscribedAck = (sentAt: number): ServerEvent => ({
  kind: 'chat_subscribed',
  sessionId: 'viewed-session',
  isProcessing: false,
  pendingPermissions: [],
  timestamp: new Date(sentAt - SKEW_MS).toISOString(),
} as unknown as ServerEvent);

beforeEach(() => {
  resetServerClockOffsetForTests();
});

test('the chat_subscribed ack is what measures the browser/server offset', () => {
  const sentAt = Date.now();
  const { dispatch } = renderHandlers(new Map([['viewed-session', sentAt]]));

  dispatch(subscribedAck(sentAt));

  const offset = getServerClockOffsetMs();
  assert.ok(
    offset < -SKEW_MS + 2_000 && offset > -SKEW_MS - 2_000,
    `expected roughly ${-SKEW_MS}, got ${offset}`,
  );
});

test('an ack for a subscribe we never recorded sending is not a sample', () => {
  const { dispatch } = renderHandlers(new Map());

  dispatch(subscribedAck(Date.now()));

  assert.equal(getServerClockOffsetMs(), 0);
});

test('a protocol_error row is stamped on the server timeline', () => {
  const sentAt = Date.now();
  const { dispatch, appended } = renderHandlers(new Map([['viewed-session', sentAt]]));

  dispatch(subscribedAck(sentAt));
  dispatch({
    kind: 'protocol_error',
    sessionId: 'viewed-session',
    code: 'boom',
    error: 'Request failed',
  } as unknown as ServerEvent);

  assert.equal(appended.length, 1);
  const stamped = Date.parse(appended[0].timestamp as string);
  assert.ok(
    stamped < Date.now() - SKEW_MS + 2_000,
    `error row should sit on the server clock, got ${appended[0].timestamp}`,
  );
});

test('a streaming row is stamped on the server timeline', () => {
  const sentAt = Date.now();
  recordServerClockSample(new Date(sentAt - SKEW_MS).toISOString(), sentAt, sentAt + 40);

  const { result } = renderHook(() => useSessionStore());
  act(() => {
    result.current.updateStreaming('session-1', 'partial answer', 'claude');
  });

  const streaming = result.current
    .getMessages('session-1')
    .find((message) => message.kind === 'stream_delta');
  assert.ok(streaming, 'streaming row should be in the store');
  const stamped = Date.parse(streaming.timestamp as string);
  assert.ok(
    stamped < Date.now() - SKEW_MS + 2_000,
    `streaming row should sit on the server clock, got ${streaming.timestamp}`,
  );
});
