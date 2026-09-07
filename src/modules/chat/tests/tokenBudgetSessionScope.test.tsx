import assert from 'node:assert/strict';

import { renderHook } from '@testing-library/react';
import { test } from 'vitest';

import { useChatRealtimeHandlers } from '@/modules/chat/hooks/useChatRealtimeHandlers';
import type { ServerEvent, ProjectSession } from '@/shared/types';
import type { SessionStore } from '@/modules/chat/hooks/useSessionStore';

/**
 * Several sessions can stream at once, and the server stamps every
 * `token_budget` status event with its session id. The composer counter shows
 * the viewed session's context, so a budget from another running session must
 * not overwrite it — that is what made the number drop and jump around while a
 * response was generating.
 */

const renderHandlers = () => {
  let listener: ((event: ServerEvent) => void) | null = null;
  const budgets: Array<Record<string, unknown> | null> = [];

  renderHook(() => useChatRealtimeHandlers({
    isActive: true,
    subscribe: (fn) => {
      listener = fn;
      return () => { listener = null; };
    },
    provider: 'claude',
    selectedSession: { id: 'viewed-session' } as ProjectSession,
    currentSessionId: 'viewed-session',
    setTokenBudget: (budget) => budgets.push(budget),
    pendingPermissionRequests: [],
    setPendingPermissionRequests: () => {},
    streamTimerRef: { current: null },
    accumulatedStreamRef: { current: '' },
    lastSeqRef: { current: new Map() },
    statusCheckSentAtRef: { current: new Map() },
    requestLatestMessages: async () => {},
    sessionStore: {} as SessionStore,
  }));

  const dispatch = (event: ServerEvent) => listener?.(event);
  return { budgets, dispatch };
};

const budgetEvent = (sessionId: string): ServerEvent => ({
  kind: 'status',
  text: 'token_budget',
  sessionId,
  tokenBudget: { used: 1234, total: 160000 },
} as unknown as ServerEvent);

test('adopts token budgets stamped with the viewed session', () => {
  const { budgets, dispatch } = renderHandlers();

  dispatch(budgetEvent('viewed-session'));

  assert.equal(budgets.length, 1);
  assert.deepEqual(budgets[0], { used: 1234, total: 160000 });
});

test('ignores token budgets from other running sessions', () => {
  const { budgets, dispatch } = renderHandlers();

  dispatch(budgetEvent('some-other-session'));

  assert.equal(budgets.length, 0);
});
