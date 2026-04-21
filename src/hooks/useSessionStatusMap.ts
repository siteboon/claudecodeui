import { useMemo } from 'react';
import type { SessionStatus } from '../types/app';

type UseSessionStatusMapArgs = {
  activeSessions: Set<string>;
  processingSessions: Set<string>;
};

/**
 * Derives a SessionStatus for each session id based on active/processing sets.
 *
 * - `activeSessions` tracks sessions with an open SSE connection (running).
 * - `processingSessions` tracks sessions awaiting user permission (waiting).
 * - Everything else defaults to 'idle'.
 *
 * Status derivation is approximate — only tracks sessions visible in the
 * current browser tab. Good enough for V1.
 */
export function useSessionStatusMap({
  activeSessions,
  processingSessions,
}: UseSessionStatusMapArgs): Map<string, SessionStatus> {
  return useMemo(() => {
    const map = new Map<string, SessionStatus>();

    for (const id of processingSessions) {
      map.set(id, 'waiting');
    }

    for (const id of activeSessions) {
      // Don't overwrite 'waiting' — permission requests take priority
      if (!map.has(id)) {
        map.set(id, 'running');
      }
    }

    return map;
  }, [activeSessions, processingSessions]);
}
