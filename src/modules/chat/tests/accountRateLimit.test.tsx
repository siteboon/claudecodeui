import assert from 'node:assert/strict';

import { renderHook } from '@testing-library/react';
import { test, beforeEach } from 'vitest';

import { useChatRealtimeHandlers } from '@/modules/chat/hooks/useChatRealtimeHandlers';
import { getAccountRateLimit, setAccountRateLimit } from '@/modules/chat/hooks/useAccountRateLimit';
import type { ServerEvent, ProjectSession } from '@/shared/types';
import type { SessionStore } from '@/modules/chat/hooks/useSessionStore';

/**
 * The quota is per account, which is the whole reason it is not stored beside
 * `tokenBudget`: a budget stamped with another session must be ignored, and a
 * quota stamped with another session must not be — it is the same allowance,
 * and dropping it would leave the badge showing a stale number for as long as
 * the user is looking at a session that is not the one running.
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

const quotaEvent = (sessionId: string, utilization: number): ServerEvent => ({
  kind: 'status',
  text: 'rate_limit',
  sessionId,
  rateLimit: {
    status: 'allowed',
    activeWindow: 'five_hour',
    resetsAt: 1789745400,
    windows: [{ type: 'five_hour', utilization, resetsAt: 1789745400 }],
    overage: { status: null, resetsAt: null, disabledReason: null, inUse: false },
  },
} as unknown as ServerEvent);

beforeEach(() => {
  setAccountRateLimit(null);
});

test('adopts a quota reported by the viewed session', () => {
  const { dispatch } = renderHandlers();

  dispatch(quotaEvent('viewed-session', 0.17));

  assert.equal(getAccountRateLimit()?.windows[0].utilization, 0.17);
});

test('adopts a quota reported by another running session', () => {
  const { dispatch } = renderHandlers();

  dispatch(quotaEvent('other-session', 0.42));

  assert.equal(getAccountRateLimit()?.windows[0].utilization, 0.42);
});

test('leaves the per-session token budget alone', () => {
  const { budgets, dispatch } = renderHandlers();

  dispatch(quotaEvent('viewed-session', 0.17));

  assert.equal(budgets.length, 0);
});
