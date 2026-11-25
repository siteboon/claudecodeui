import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { api } from '@/shared/api';
import { SessionPinsContext } from '@/modules/sidebar/context/SessionPinsContext';
import type { Project, PinnedConversationListItem } from '@/shared/types';

async function readPins(response: Response): Promise<PinnedConversationListItem[]> {
  if (!response.ok) throw new Error(`Session pins request failed: ${response.status}`);
  const payload = await response.json() as { data?: { sessions?: PinnedConversationListItem[] } };
  if (!Array.isArray(payload.data?.sessions)) throw new Error('Invalid session pins response');
  return payload.data.sessions;
}

async function requestPins(request: (signal: AbortSignal) => Promise<Response>, controllers: Set<AbortController>) {
  const controller = new AbortController();
  controllers.add(controller);
  const timer = window.setTimeout(() => controller.abort(), 30_000);
  try {
    return await readPins(await request(controller.signal));
  } finally {
    window.clearTimeout(timer);
    controllers.delete(controller);
  }
}

/** Sidebar owns this store so Projects, Conversations and their row controls share one server-backed pin list. */
export function SessionPinsProvider({ projects, children }: { projects: Project[]; children: ReactNode }) {
  // Keep the last confirmed server order available during refresh and retry.
  const [sessions, setSessions] = useState<PinnedConversationListItem[]>([]);
  // Enable pin controls only after the initial server state is available.
  const [ready, setReady] = useState(false);
  // Keep a recoverable error visible alongside the last confirmed list.
  const [hasError, setHasError] = useState(false);
  // Surface which row is saving and prevent overlapping mutations.
  const [pendingSessionId, setPendingSessionId] = useState<string | null>(null);
  const pendingRef = useRef<string | null>(null);
  const sequenceRef = useRef(0);
  const readingRef = useRef(false);
  const controllersRef = useRef(new Set<AbortController>());
  const mountedRef = useRef(true);
  const previousProjectsRef = useRef(projects);

  const refresh = useCallback(async () => {
    if (pendingRef.current || readingRef.current) return;
    readingRef.current = true;
    const sequence = ++sequenceRef.current;
    try {
      const next = await requestPins((signal) => api.pinnedSessions({ signal }), controllersRef.current);
      if (!mountedRef.current || sequence !== sequenceRef.current) return;
      setSessions((previous) => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
      setReady(true);
      setHasError(false);
    } catch (error) {
      if (!mountedRef.current || sequence !== sequenceRef.current) return;
      console.error('[Sidebar] Failed to load session pins:', error);
      setHasError(true);
    } finally {
      readingRef.current = false;
    }
  }, []);

  const setPinned = useCallback(async (sessionId: string, isPinned: boolean) => {
    // Serialize mutations and invalidate older reads. A slow poll must never
    // put an unpinned row back, and double taps must never reorder a pin.
    if (pendingRef.current) return;
    pendingRef.current = sessionId;
    setPendingSessionId(sessionId);
    const sequence = ++sequenceRef.current;
    try {
      const next = await requestPins((signal) => api.setSessionPinned(sessionId, isPinned, { signal }), controllersRef.current);
      if (!mountedRef.current || sequence !== sequenceRef.current) return;
      setSessions(next);
      setReady(true);
      setHasError(false);
    } catch (error) {
      if (mountedRef.current) {
        console.error('[Sidebar] Failed to save session pin:', error);
        setHasError(true);
      }
    } finally {
      pendingRef.current = null;
      if (mountedRef.current) setPendingSessionId(null);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const requests = sequenceRef;
    const controllers = controllersRef.current;
    const initialTimer = window.setTimeout(() => void refresh(), 0);
    const refreshVisible = () => {
      if (document.visibilityState !== 'hidden') void refresh();
    };
    // Also catch pins changed on another device, including after a suspended
    // mobile tab returns. No browser storage is the source of truth.
    const timer = window.setInterval(refreshVisible, 10_000);
    window.addEventListener('focus', refreshVisible);
    document.addEventListener('visibilitychange', refreshVisible);
    return () => {
      mountedRef.current = false;
      ++requests.current;
      for (const controller of controllers) controller.abort();
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
      window.removeEventListener('focus', refreshVisible);
      document.removeEventListener('visibilitychange', refreshVisible);
    };
  }, [refresh]);

  useEffect(() => {
    if (previousProjectsRef.current === projects) return;
    previousProjectsRef.current = projects;
    // Project refreshes follow rename/archive/delete/restore and transcript
    // updates. Fetch summaries even for pins outside loaded project pages.
    const timer = window.setTimeout(() => void refresh(), 300);
    return () => window.clearTimeout(timer);
  }, [projects, refresh]);

  const pinnedIds = useMemo(() => new Set(sessions.map((session) => session.sessionId)), [sessions]);
  const value = useMemo(() => ({
    sessions, pinnedIds, ready, hasError, pendingSessionId, refresh, setPinned,
  }), [sessions, pinnedIds, ready, hasError, pendingSessionId, refresh, setPinned]);

  return <SessionPinsContext.Provider value={value}>{children}</SessionPinsContext.Provider>;
}
