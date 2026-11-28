import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { showAttentionTitleIndicator } from '@/modules/chat/utils/pageTitleNotification';
import { playNotificationSound } from '@/shared/utils';
import { useWebSocket } from '@/shared/context/WebSocketContext';
import type { ServerEvent } from '@/shared/types';

/**
 * Which sessions are stopped and waiting on the user.
 *
 * A run's permission request used to reach only the sockets subscribed to that
 * run, so a question raised in a session the user was not looking at left no
 * trace anywhere: the sidebar row looked like any other, nothing sounded, and
 * the turn sat there until its approval timed out. The server now announces
 * every request on a separate `permission_attention` frame; this provider is
 * the one place that collects those announcements and turns them into the two
 * things the user can actually notice — a sidebar marker and a notification.
 *
 * It is deliberately independent of the chat view's own pending list: that list
 * only exists while a session is open, which is exactly when the user does not
 * need to be told about it.
 */

type PendingBySession = ReadonlyMap<string, ReadonlySet<string>>;

const EMPTY_SESSIONS: ReadonlySet<string> = new Set();

/**
 * Defaults to "nothing is waiting" rather than throwing. Sidebar rows are
 * rendered on their own in tests and previews; a marker that cannot be known
 * must leave the row exactly as it was, never take the sidebar down with it.
 */
const PermissionAttentionContext = createContext<PendingBySession>(new Map());

/** `/session/<id>` is the only route that shows a conversation. */
const readViewedSessionId = (): string | null => {
  if (typeof window === 'undefined') {
    return null;
  }

  const match = /\/session\/([^/?#]+)/.exec(window.location.pathname);
  return match ? decodeURIComponent(match[1]) : null;
};

const addRequest = (current: PendingBySession, sessionId: string, requestId: string): PendingBySession => {
  const existing = current.get(sessionId);
  if (existing?.has(requestId)) {
    return current;
  }

  const next = new Map(current);
  next.set(sessionId, new Set([...(existing ?? []), requestId]));
  return next;
};

const removeRequest = (
  current: PendingBySession,
  sessionId: string,
  requestId: string | null,
): PendingBySession => {
  const existing = current.get(sessionId);
  if (!existing) {
    return current;
  }

  const remaining = requestId
    ? new Set([...existing].filter((id) => id !== requestId))
    : new Set<string>();

  if (remaining.size === existing.size) {
    return current;
  }

  const next = new Map(current);
  if (remaining.size === 0) {
    next.delete(sessionId);
  } else {
    next.set(sessionId, remaining);
  }
  return next;
};

/** Builds the state from a snapshot frame, ignoring anything malformed. */
const readSnapshot = (event: ServerEvent): PendingBySession => {
  const next = new Map<string, Set<string>>();
  const sessions = Array.isArray(event.sessions) ? event.sessions : [];

  for (const entry of sessions) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const { sessionId, requestId } = entry as { sessionId?: unknown; requestId?: unknown };
    if (typeof sessionId !== 'string' || !sessionId) {
      continue;
    }
    if (typeof requestId !== 'string' || !requestId) {
      continue;
    }
    const requests = next.get(sessionId) ?? new Set<string>();
    requests.add(requestId);
    next.set(sessionId, requests);
  }

  return next;
};

export function PermissionAttentionProvider({ children }: { children: ReactNode }) {
  const { subscribe, sendMessage, connectionStatus } = useWebSocket();
  const [pendingBySession, setPendingBySession] = useState<PendingBySession>(() => new Map());

  // The announcements are deltas, so a set collected only from them is wrong in
  // both directions after a reconnect: requests raised while the socket was
  // down were never heard (no marker, no alert) and requests answered then kept
  // their marker until a reload. Ask for the current state on every handshake —
  // the first one included, since requests can predate this page load — and let
  // the frame below replace what the deltas built.
  useEffect(() => {
    if (connectionStatus === 'connected') {
      sendMessage({ type: 'chat.attention-snapshot' });
    }
  }, [connectionStatus, sendMessage]);

  useEffect(() => {
    return subscribe((event: ServerEvent) => {
      const kind = event.kind;

      if (kind === 'permission_attention_snapshot') {
        // Replace, never merge: requests missing from it were answered while
        // this client was away (or ended with their run) and must not linger.
        // No alert here — the user is looking at the page the snapshot lands on.
        setPendingBySession(readSnapshot(event));
        return;
      }

      const sessionId = typeof event.sessionId === 'string' ? event.sessionId : '';
      if (!sessionId) {
        return;
      }

      if (kind === 'permission_attention') {
        const requestId = typeof event.requestId === 'string' ? event.requestId : '';
        if (!requestId) {
          return;
        }

        setPendingBySession((current) => addRequest(current, sessionId, requestId));

        // The open conversation already sounds its own alert for the prompt it
        // is showing; alerting again here would double up.
        if (sessionId !== readViewedSessionId()) {
          playNotificationSound();
          showAttentionTitleIndicator();
        }
        return;
      }

      if (kind === 'permission_attention_cleared') {
        const requestId = typeof event.requestId === 'string' && event.requestId
          ? event.requestId
          : null;
        setPendingBySession((current) => removeRequest(current, sessionId, requestId));
      }
    });
  }, [subscribe]);

  return (
    <PermissionAttentionContext.Provider value={pendingBySession}>
      {children}
    </PermissionAttentionContext.Provider>
  );
}

/**
 * Sessions with at least one prompt waiting. Sidebar rows key their marker off
 * this; the identity is stable between unrelated updates so rows do not
 * re-render when a different session's prompt resolves.
 */
export function useAwaitingInputSessionIdSet(): ReadonlySet<string> {
  const pendingBySession = useContext(PermissionAttentionContext);

  return useMemo(
    () => (pendingBySession.size === 0 ? EMPTY_SESSIONS : new Set(pendingBySession.keys())),
    [pendingBySession],
  );
}
