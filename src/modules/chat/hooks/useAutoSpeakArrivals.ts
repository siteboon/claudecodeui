import { useEffect, useRef } from 'react';

import { baselineTurn, speakRefreshedTurn } from '@/modules/chat/utils/autoSpeakTurn';
import type { SessionStore } from '@/modules/chat/hooks/useSessionStore';
import type { ChatMessage, LLMProvider } from '@/shared/types';

type UseAutoSpeakArrivalsArgs = {
  /** The conversation on screen, or null before the first send allocates one. */
  sessionId: string | null;
  provider: LLMProvider;
  /** Only a change signal; the turn is read from the store, not from this window. */
  chatMessages: ChatMessage[];
  /** A run this client is streaming. Its turn is spoken from `complete` instead. */
  isProcessing: boolean;
  /** Whether the chat tab is the visible one. */
  isActive: boolean;
  isLoadingSessionMessages: boolean;
  sessionStore: SessionStore;
};

/**
 * Speaks assistant turns that arrive from outside this client — another device or
 * tab, the provider CLI, a scheduled message. Only one client streams a given
 * run, so a phone that sends a message gets `complete` while a laptop showing the
 * same conversation only gets the transcript watcher's refresh.
 *
 * The rest of this hook keeps it quiet whenever speaking would land as audio from
 * nowhere.
 */
export function useAutoSpeakArrivals({
  sessionId,
  provider,
  chatMessages,
  isProcessing,
  isActive,
  isLoadingSessionMessages,
  sessionStore,
}: UseAutoSpeakArrivalsArgs): void {
  const openedSessionIdRef = useRef<string | null>(null);
  const wasActiveRef = useRef(isActive);
  /**
   * The transcript's fetch stamp when the chat tab became visible again, while a
   * deferred refresh may still be on its way.
   *
   * Returning from the Files or Git tab does not look like opening a session —
   * the transcript is already hydrated, so nothing sets
   * `isLoadingSessionMessages` — but refreshes are queued while chat is hidden
   * and flushed on return, landing a commit or two later. Waiting for the store's
   * own stamp to move is what separates that flush from a live arrival.
   */
  const awaitingDeferredRefreshRef = useRef<number | null>(null);

  useEffect(() => {
    if (!sessionId || isProcessing) return;

    const wasActive = wasActiveRef.current;
    wasActiveRef.current = isActive;
    const fetchedAt = sessionStore.getSessionSlot(sessionId)?.fetchedAt ?? null;

    if (isActive && !wasActive) {
      awaitingDeferredRefreshRef.current = fetchedAt;
    }
    if (awaitingDeferredRefreshRef.current !== null) {
      // Silent until the flush lands, and silent for that observation too, since
      // it carries whatever arrived while away.
      if (fetchedAt !== awaitingDeferredRefreshRef.current) {
        awaitingDeferredRefreshRef.current = null;
      }
      baselineTurn({ sessionId, provider, sessionStore });
      return;
    }

    // Still opening: re-baseline until the transcript settles, and count arrivals
    // only from there.
    if (isLoadingSessionMessages || openedSessionIdRef.current !== sessionId) {
      baselineTurn({ sessionId, provider, sessionStore });
      if (!isLoadingSessionMessages) {
        openedSessionIdRef.current = sessionId;
      }
      return;
    }

    speakRefreshedTurn({ sessionId, provider, sessionStore, visible: isActive });
  }, [chatMessages, isActive, isLoadingSessionMessages, isProcessing, provider, sessionId, sessionStore]);
}
