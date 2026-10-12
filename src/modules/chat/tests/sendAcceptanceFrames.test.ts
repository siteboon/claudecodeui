import assert from 'node:assert/strict';

import { renderHook } from '@testing-library/react';
import { test } from 'vitest';

import { useChatRealtimeHandlers } from '@/modules/chat/hooks/useChatRealtimeHandlers';
import type { NormalizedMessage, ProjectSession, ServerEvent } from '@/shared/types';
import type { SessionStore } from '@/modules/chat/hooks/useSessionStore';

/**
 * The server acknowledges a tagged turn with `chat_send_accepted` and echoes
 * the tag on a refusal. Both belong to the composer that sent the turn — it
 * waits for them and reports a refusal beside the draft it kept — so the
 * transcript must not draw either: an unknown kind would otherwise be stored
 * as a message row, and a refusal would be drawn twice (and, in a new chat
 * with no session yet, carried into whichever session opens next).
 */

const renderHandlers = () => {
  let listener: ((event: ServerEvent) => void) | null = null;
  const stored: NormalizedMessage[] = [];
  const idled: Array<string | null | undefined> = [];

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
    onSessionIdle: (sessionId) => { idled.push(sessionId); },
    requestLatestMessages: async () => {},
    sessionStore: {
      appendRealtime: (_sessionId: string, message: NormalizedMessage) => { stored.push(message); },
      getMessages: () => stored,
      updateStreaming: () => {},
      finalizeStreaming: () => {},
    } as unknown as SessionStore,
  }));

  const dispatch = (event: ServerEvent) => listener?.(event);
  return { dispatch, stored, idled };
};

test('an acknowledgement is not drawn in the transcript', () => {
  const { dispatch, stored } = renderHandlers();

  dispatch({ kind: 'chat_send_accepted', sessionId: 'viewed-session', clientRequestId: 'request-1' });

  assert.deepEqual(stored, []);
});

test('a refusal of a tagged turn is left to the composer that sent it', () => {
  const { dispatch, stored, idled } = renderHandlers();

  dispatch({
    kind: 'protocol_error',
    code: 'RUN_IN_PROGRESS',
    error: 'Session "viewed-session" already has a run in progress.',
    sessionId: 'viewed-session',
    clientRequestId: 'request-1',
  });

  assert.deepEqual(stored, []);
  assert.deepEqual(idled, [], 'the run that is in progress keeps its indicator');
});

test('a protocol error without a tag is still drawn and stops the spinner', () => {
  const { dispatch, stored, idled } = renderHandlers();

  dispatch({ kind: 'protocol_error', code: 'NO_ACTIVE_RUN', error: 'No active run.', sessionId: 'viewed-session' });

  assert.equal(stored.length, 1);
  assert.equal(stored[0]?.kind, 'error');
  assert.deepEqual(idled, ['viewed-session']);
});
