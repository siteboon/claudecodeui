import type { NormalizedMessage, SessionSlot } from './useSessionStore';

const EMPTY: NormalizedMessage[] = [];

export function createEmptySlot(): SessionSlot {
  return {
    serverMessages: EMPTY,
    realtimeMessages: EMPTY,
    merged: EMPTY,
    _lastServerRef: EMPTY,
    _lastRealtimeRef: EMPTY,
    status: 'idle',
    fetchedAt: 0,
    total: 0,
    hasMore: false,
    offset: 0,
    tokenUsage: undefined,
    _historyMutationQueue: Promise.resolve(),
  };
}
