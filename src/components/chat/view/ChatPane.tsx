import { useEffect } from 'react';

import type { ChatInterfaceProps } from '../types/types';
import { registerPane, unregisterPane, usePaneTick } from '../../../stores/useSessionStore';

import ChatInterface from './ChatInterface';

export interface ChatPaneProps extends ChatInterfaceProps {
  paneId: string;
  isFocused: boolean;
}

// Thin wrapper so that each pane gets its own component subtree — per-pane
// hooks (useChatSessionState, useChatComposerState) are naturally isolated by
// React's component identity. Non-focused panes stay mounted but hidden so
// WebSocket deltas continue to accumulate into their session's store.
//
// paneId is typically the session id itself (single-session-per-pane is the
// current model), but it is threaded as its own prop so future pane types
// (split layouts, non-session panes) can diverge without a prop rename.
export default function ChatPane({ paneId, isFocused, ...chatProps }: ChatPaneProps) {
  const sessionId = chatProps.selectedSession?.id ?? null;

  // Register this pane with the store so its session id is in the active set
  // and deltas for it fire the per-session listeners usePaneTick subscribes
  // to. Using the real session id (not paneId) — the store keys on session,
  // not pane, because the same session can be open in multiple panes.
  useEffect(() => {
    if (!sessionId) return;
    registerPane(sessionId);
    return () => {
      unregisterPane(sessionId);
    };
  }, [sessionId]);

  // Subscribe to the per-session tick. Returned number is unused in the JSX
  // but the hook still drives re-renders for this subtree via
  // useSyncExternalStore; hooks deeper in ChatInterface read the latest
  // store state through the same cadence.
  usePaneTick(sessionId);

  return (
    <div
      className={`h-full ${isFocused ? 'block' : 'hidden'}`}
      data-pane-id={paneId}
      role="tabpanel"
      aria-hidden={!isFocused}
    >
      <ChatInterface {...chatProps} />
    </div>
  );
}
