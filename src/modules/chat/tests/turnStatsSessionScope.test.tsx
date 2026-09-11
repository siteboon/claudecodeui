import assert from 'node:assert/strict';

import { renderHook } from '@testing-library/react';
import { test } from 'vitest';

import { useChatRealtimeHandlers } from '@/modules/chat/hooks/useChatRealtimeHandlers';
import type { ServerEvent, ProjectSession, TurnStats } from '@/shared/types';
import type { SessionStore } from '@/modules/chat/hooks/useSessionStore';

/**
 * The turn bill (cost/duration/tokens) arrives on a `status`/`turn_stats`
 * frame stamped with its own session id. The panel shows the viewed session's
 * bill, so a result from another concurrently running session must not
 * overwrite it — the same session-scoping rule the composer's context counter
 * already follows for `token_budget`.
 */

const renderHandlers = () => {
  let listener: ((event: ServerEvent) => void) | null = null;
  const stats: Array<TurnStats | null> = [];

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
    setTurnStats: (next) => stats.push(next),
    pendingPermissionRequests: [],
    setPendingPermissionRequests: () => {},
    streamTimerRef: { current: null },
    accumulatedStreamRef: { current: '' },
    thinkingStreamTimerRef: { current: null },
    accumulatedThinkingStreamRef: { current: '' },
    lastSeqRef: { current: new Map() },
    statusCheckSentAtRef: { current: new Map() },
    requestLatestMessages: async () => {},
    sessionStore: {} as SessionStore,
  }));

  const dispatch = (event: ServerEvent) => listener?.(event);
  return { stats, dispatch };
};

const statsEvent = (sessionId: string): ServerEvent => ({
  kind: 'status',
  text: 'turn_stats',
  sessionId,
  turnStats: {
    costUsd: 0.04,
    durationMs: 12_000,
    apiDurationMs: 4_000,
    numTurns: 3,
    usage: { inputTokens: 10, outputTokens: 220, cacheReadTokens: 900, cacheCreationTokens: 20 },
  },
} as unknown as ServerEvent);

test('adopts turn stats stamped with the viewed session', () => {
  const { stats, dispatch } = renderHandlers();

  dispatch(statsEvent('viewed-session'));

  assert.equal(stats.length, 1);
  assert.equal(stats[0]?.costUsd, 0.04);
  assert.equal(stats[0]?.numTurns, 3);
});

test('ignores turn stats from other running sessions', () => {
  const { stats, dispatch } = renderHandlers();

  dispatch(statsEvent('some-other-session'));

  assert.equal(stats.length, 0);
});
