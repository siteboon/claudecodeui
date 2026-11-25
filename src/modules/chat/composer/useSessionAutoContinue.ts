import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '@/shared/api';

/**
 * Whether one session continues automatically once a usage limit that stopped
 * it resets. Off until the user turns it on for that session.
 */
export function useSessionAutoContinue(sessionId: string | null) {
  const [enabled, setEnabledState] = useState(false);
  const activeSessionRef = useRef(sessionId);
  // Bumped by a session switch and by every change: a read that lands after
  // something newer happened is dropped instead of overwriting it.
  const generationRef = useRef(0);
  // The last value the server confirmed for the active session: the fallback when it cannot be read.
  const confirmedRef = useRef(false);
  // Saves run one after another, so the last click is the last write the server sees.
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());

  // Reset during the switch render, so the old session's setting never paints on the new one.
  const [renderedSessionId, setRenderedSessionId] = useState(sessionId);
  if (renderedSessionId !== sessionId) {
    setRenderedSessionId(sessionId);
    setEnabledState(false);
  }

  /**
   * Reads the server's value and shows it, unless something newer happened
   * meanwhile. Returns whether the server could be read, not whether it was shown.
   */
  const load = useCallback(async (id: string): Promise<boolean> => {
    const generation = generationRef.current;
    try {
      const response = await api.sessionAutoContinue(id);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      if (generationRef.current === generation) {
        confirmedRef.current = payload?.data?.enabled === true;
        setEnabledState(confirmedRef.current);
      }
      return true;
    } catch (error) {
      console.error('Failed to load auto-continue setting:', error);
      return false;
    }
  }, []);

  useEffect(() => {
    activeSessionRef.current = sessionId;
    generationRef.current += 1;
    confirmedRef.current = false;
    if (sessionId) void load(sessionId);
  }, [load, sessionId]);

  const setEnabled = useCallback(async (next: boolean) => {
    // A handler from before a session switch must not write to the old session.
    if (!sessionId || activeSessionRef.current !== sessionId) return;
    const generation = ++generationRef.current;
    setEnabledState(next);
    const save = saveChainRef.current.then(async () => {
      try {
        const response = await api.setSessionAutoContinue(sessionId, next);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        if (activeSessionRef.current === sessionId) confirmedRef.current = next;
      } catch (error) {
        console.error('Failed to save auto-continue setting:', error);
        // Show what the server has rather than guessing; skipped if something newer happened.
        if (generationRef.current !== generation) return;
        if (await load(sessionId)) return;
        // Unreadable too: show the last confirmed value, unless something newer happened.
        if (generationRef.current === generation) setEnabledState(confirmedRef.current);
      }
    });
    saveChainRef.current = save;
    await save;
  }, [load, sessionId]);

  return { enabled, setEnabled };
}
