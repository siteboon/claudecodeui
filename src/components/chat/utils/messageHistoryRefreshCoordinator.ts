export type MessageHistoryRefreshExecutor = (sessionId: string) => Promise<boolean | void>;
export type CanRefreshMessageHistory = (sessionId: string) => boolean;

export type MessageHistoryRefreshCoordinator = {
  request: (sessionId: string, allowNetwork?: boolean) => Promise<void>;
  flushPending: (sessionId: string) => Promise<void>;
  discardPending: (sessionId: string) => void;
  hasPending: (sessionId: string) => boolean;
};

/**
 * Coalesces automatic persisted-history refresh signals without owning any
 * React state. Hidden sessions remain dirty until they become visible; active
 * bursts collapse into the current request plus at most one trailing request.
 */
export function createMessageHistoryRefreshCoordinator(
  executeRefresh: MessageHistoryRefreshExecutor,
  canRefreshNow: CanRefreshMessageHistory,
): MessageHistoryRefreshCoordinator {
  const pendingSessions = new Set<string>();
  const inFlightBySession = new Map<string, Promise<void>>();

  const drain = (sessionId: string): Promise<void> => {
    const existing = inFlightBySession.get(sessionId);
    if (existing) {
      pendingSessions.add(sessionId);
      return existing;
    }

    const request = (async () => {
      try {
        do {
          pendingSessions.delete(sessionId);
          const completed = await executeRefresh(sessionId);
          if (completed === false) {
            pendingSessions.add(sessionId);
            break;
          }
        } while (pendingSessions.has(sessionId) && canRefreshNow(sessionId));
      } catch {
        pendingSessions.add(sessionId);
      }
    })().finally(() => {
      inFlightBySession.delete(sessionId);
    });

    inFlightBySession.set(sessionId, request);
    return request;
  };

  return {
    request(sessionId: string, allowNetwork = true): Promise<void> {
      if (!allowNetwork || !canRefreshNow(sessionId)) {
        pendingSessions.add(sessionId);
        return Promise.resolve();
      }
      return drain(sessionId);
    },

    flushPending(sessionId: string): Promise<void> {
      if (!pendingSessions.has(sessionId) || !canRefreshNow(sessionId)) {
        return Promise.resolve();
      }
      return drain(sessionId);
    },

    discardPending(sessionId: string): void {
      pendingSessions.delete(sessionId);
    },

    hasPending(sessionId: string): boolean {
      return pendingSessions.has(sessionId);
    },
  };
}
