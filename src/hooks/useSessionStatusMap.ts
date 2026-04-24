import { useMemo } from 'react';
import type { SessionStatus } from '../types/app';

type UseSessionStatusMapArgs = {
  activeSessions: Set<string>;
  processingSessions: Set<string>;
};

/**
 * Derives a SessionStatus for each session id based on active/processing sets.
 *
 * - `activeSessions` → `running`: Claude is currently working (streaming a turn).
 * - `processingSessions` → `waiting`: Claude finished a turn and is stalled
 *   until the user replies. This is the "needs you" / pink-alert state.
 * - Everything else defaults to 'idle'.
 *
 * `running` wins over `waiting` if a session somehow appears in both — an active
 * turn is the more urgent real-time signal than a stale awaiting-reply flag.
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
      map.set(id, 'running');
    }

    return map;
  }, [activeSessions, processingSessions]);
}
