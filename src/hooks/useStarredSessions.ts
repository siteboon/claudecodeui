import { useCallback, useSyncExternalStore } from 'react';

import {
  getStarredSessions,
  subscribeToStarredSessions,
  toggleSessionStar,
} from '../utils/starredSessions';

/**
 * React-friendly view of the starred-sessions store.
 * Re-renders when stars change in this tab or another tab.
 */
export function useStarredSessions() {
  const starredIds = useSyncExternalStore(
    subscribeToStarredSessions,
    getSnapshot,
    getServerSnapshot,
  );

  const isStarred = useCallback(
    (sessionId: string) => starredIds.has(sessionId),
    [starredIds],
  );

  const toggle = useCallback((sessionId: string) => {
    toggleSessionStar(sessionId);
  }, []);

  return { starredIds, isStarred, toggle };
}

// `getSnapshot` must return a referentially stable value when nothing has
// changed. We memoize the most recent Set so React's bail-out works.
let cachedSet: Set<string> | null = null;
let cachedSerialized = '';

function getSnapshot(): Set<string> {
  const current = getStarredSessions();
  const serialized = JSON.stringify(Array.from(current).sort());
  if (cachedSet && serialized === cachedSerialized) {
    return cachedSet;
  }
  cachedSet = current;
  cachedSerialized = serialized;
  return current;
}

function getServerSnapshot(): Set<string> {
  return new Set();
}
