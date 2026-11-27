import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { isPageActive, playNotificationSound, showAttentionTitleIndicator } from '@/shared/utils';
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
 * the one place that collects those announcements and turns them into the
 * things the user can actually notice — a sidebar marker, an alert, and the
 * newest arrival that the workspace's toast card renders.
 *
 * It is deliberately independent of the chat view's own pending list: that list
 * only exists while a session is open, which is exactly when the user does not
 * need to be told about it.
 */

type AttentionNotice = {
  sessionId: string;
  requestId: string;
};

type PermissionAttentionState = {
  /** Ordered oldest-to-newest so the latest unanswered request can drive the toast card. */
  pendingRequests: ReadonlyArray<AttentionNotice>;
  /** `${sessionId}:${requestId}` entries the user explicitly dismissed from the toast. */
  dismissedKeys: ReadonlySet<string>;
  /** Hides the toast card for the current off-screen requests without answering them. */
  dismissNotice: (requestId: string, excludedSessionId?: string | null) => void;
};

const EMPTY_SESSIONS: ReadonlySet<string> = new Set();
const EMPTY_KEYS: ReadonlySet<string> = new Set();

/**
 * Defaults to "nothing is waiting" rather than throwing. Sidebar rows are
 * rendered on their own in tests and previews; a marker that cannot be known
 * must leave the row exactly as it was, never take the sidebar down with it.
 */
const PermissionAttentionContext = createContext<PermissionAttentionState>({
  pendingRequests: [],
  dismissedKeys: EMPTY_KEYS,
  dismissNotice: () => {},
});

const requestKey = (sessionId: string, requestId: string): string => `${sessionId}:${requestId}`;

const safeDecodeURIComponent = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

/** `/session/<id>` is the only route that shows a conversation. */
const readViewedSessionId = (): string | null => {
  if (typeof window === 'undefined') {
    return null;
  }

  const match = /\/session\/([^/?#]+)/.exec(window.location.pathname);
  return match ? safeDecodeURIComponent(match[1]) : null;
};

const appendPendingRequest = (
  current: ReadonlyArray<AttentionNotice>,
  sessionId: string,
  requestId: string,
): ReadonlyArray<AttentionNotice> => {
  const existingIndex = current.findIndex(
    (entry) => entry.sessionId === sessionId && entry.requestId === requestId,
  );
  if (existingIndex === current.length - 1 && existingIndex !== -1) {
    return current;
  }

  const filtered = existingIndex === -1
    ? current
    : current.filter((_, index) => index !== existingIndex);
  return [...filtered, { sessionId, requestId }];
};

const removePendingRequest = (
  current: ReadonlyArray<AttentionNotice>,
  sessionId: string,
  requestId: string | null,
): ReadonlyArray<AttentionNotice> => {
  const remaining = current.filter((entry) => (
    entry.sessionId !== sessionId || (requestId !== null && entry.requestId !== requestId)
  ));
  return remaining.length === current.length ? current : remaining;
};

/** Builds an ordered, deduplicated request list from a snapshot frame, ignoring malformed entries. */
const readSnapshot = (event: ServerEvent): ReadonlyArray<AttentionNotice> => {
  const sessions = Array.isArray(event.sessions) ? event.sessions : [];
  const indexed = new Map<string, { notice: AttentionNotice; order: number; timestampMs: number | null }>();

  sessions.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      return;
    }
    const { sessionId, requestId, timestamp } = entry as {
      sessionId?: unknown;
      requestId?: unknown;
      timestamp?: unknown;
    };
    if (typeof sessionId !== 'string' || !sessionId) {
      return;
    }
    if (typeof requestId !== 'string' || !requestId) {
      return;
    }

    const parsedTime = typeof timestamp === 'string' && timestamp ? Date.parse(timestamp) : Number.NaN;
    const timestampMs = Number.isFinite(parsedTime) ? parsedTime : null;
    indexed.set(requestKey(sessionId, requestId), {
      notice: { sessionId, requestId },
      order: index,
      timestampMs,
    });
  });

  return Array.from(indexed.values())
    .sort((left, right) => {
      if (left.timestampMs !== null && right.timestampMs !== null && left.timestampMs !== right.timestampMs) {
        return left.timestampMs - right.timestampMs;
      }
      return left.order - right.order;
    })
    .map((item) => item.notice);
};

const areRequestListsEqual = (
  left: ReadonlyArray<AttentionNotice>,
  right: ReadonlyArray<AttentionNotice>,
): boolean => (
  left.length === right.length
  && left.every((entry, index) => (
    entry.sessionId === right[index].sessionId && entry.requestId === right[index].requestId
  ))
);

/** Rendered by App at the root so sidebar indicators, title alerts and the workspace toast share one waiting-request state. */
export function PermissionAttentionProvider({ children }: { children: ReactNode }) {
  const { subscribe, sendMessage, connectionStatus } = useWebSocket();
  // Authoritative ordered list of waiting requests; drives sidebar badges and derives the toast card.
  const [pendingRequests, setPendingRequests] = useState<ReadonlyArray<AttentionNotice>>([]);
  // Tracks explicitly dismissed request keys so route switches or reconnect snapshots do not re-open them.
  const [dismissedKeys, setDismissedKeys] = useState<ReadonlySet<string>>(EMPTY_KEYS);
  // Latest pending list read by dismissNotice so dismissing closes all currently visible off-screen prompts in one click.
  const pendingRequestsRef = useRef(pendingRequests);
  useEffect(() => {
    pendingRequestsRef.current = pendingRequests;
  }, [pendingRequests]);
  /**
   * Announcements already handled, so a replayed frame cannot sound twice or
   * reopen a toast the user has dismissed. Kept in a ref because it never
   * renders and must be read synchronously inside the socket listener.
   */
  const announcedRef = useRef<Set<string>>(new Set());

  const dismissNotice = useCallback((requestId: string, excludedSessionId?: string | null) => {
    const viewedId = excludedSessionId === undefined ? readViewedSessionId() : excludedSessionId;
    const currentPending = pendingRequestsRef.current;

    setDismissedKeys((current) => {
      const next = new Set(current);
      let changed = false;

      for (const entry of currentPending) {
        if (entry.requestId === requestId || entry.sessionId !== viewedId) {
          const key = requestKey(entry.sessionId, entry.requestId);
          if (!next.has(key)) {
            next.add(key);
            changed = true;
          }
        }
      }

      return changed ? next : current;
    });
  }, []);

  // The announcements are deltas, so a set collected only from them is wrong in
  // both directions after a reconnect: requests raised while the socket was
  // down were never heard (no marker, no alert) and requests answered then kept
  // their marker until a reload. Ask for the current state on every handshake —
  // the first one included, since requests can predate this page load — and let
  // the frame below replace what the deltas built.
  useEffect(() => {
    if (connectionStatus === 'connected' && sendMessage) {
      sendMessage({ type: 'chat.attention-snapshot' });
    }
  }, [connectionStatus, sendMessage]);

  useEffect(() => {
    return subscribe((event: ServerEvent) => {
      const kind = event.kind;

      if (kind === 'permission_attention_snapshot') {
        // Replace, never merge: requests missing from it were answered while
        // this client was away (or ended with their run) and must not linger.
        // Snapshots never play sound, but a backgrounded tab still updates its
        // title when at least one request is waiting.
        const next = readSnapshot(event);
        const nextAnnounced = new Set<string>();
        for (const entry of next) {
          nextAnnounced.add(requestKey(entry.sessionId, entry.requestId));
        }
        announcedRef.current = nextAnnounced;
        setPendingRequests((current) => (areRequestListsEqual(current, next) ? current : next));
        setDismissedKeys((current) => {
          if (current.size === 0) {
            return current;
          }
          const retained = new Set([...current].filter((key) => nextAnnounced.has(key)));
          return retained.size === current.size ? current : (retained.size === 0 ? EMPTY_KEYS : retained);
        });
        if (next.length > 0 && !isPageActive()) {
          showAttentionTitleIndicator();
        }
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

        const announcementKey = requestKey(sessionId, requestId);
        if (announcedRef.current.has(announcementKey)) {
          return;
        }
        announcedRef.current.add(announcementKey);

        setPendingRequests((current) => appendPendingRequest(current, sessionId, requestId));

        const isViewedSession = sessionId === readViewedSessionId();
        if (!isViewedSession) {
          playNotificationSound();
          showAttentionTitleIndicator();
        } else if (!isPageActive()) {
          // The open conversation plays its own sound and shows the prompt inline,
          // so only a backgrounded tab needs its title to call the user back.
          showAttentionTitleIndicator();
        }
        return;
      }

      if (kind === 'permission_attention_cleared') {
        const requestId = typeof event.requestId === 'string' && event.requestId
          ? event.requestId
          : null;

        if (requestId) {
          announcedRef.current.delete(requestKey(sessionId, requestId));
        } else {
          for (const key of announcedRef.current) {
            if (key.startsWith(`${sessionId}:`)) {
              announcedRef.current.delete(key);
            }
          }
        }

        setPendingRequests((current) => removePendingRequest(current, sessionId, requestId));
        setDismissedKeys((current) => {
          if (current.size === 0) {
            return current;
          }
          const targetKey = requestId ? requestKey(sessionId, requestId) : null;
          const remaining = new Set(
            [...current].filter((key) => (
              targetKey ? key !== targetKey : !key.startsWith(`${sessionId}:`)
            )),
          );
          return remaining.size === current.size ? current : (remaining.size === 0 ? EMPTY_KEYS : remaining);
        });
      }
    });
  }, [subscribe]);

  const value = useMemo<PermissionAttentionState>(
    () => ({ pendingRequests, dismissedKeys, dismissNotice }),
    [pendingRequests, dismissedKeys, dismissNotice],
  );

  return (
    <PermissionAttentionContext.Provider value={value}>
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
  const { pendingRequests } = useContext(PermissionAttentionContext);

  return useMemo(
    () => (pendingRequests.length === 0
      ? EMPTY_SESSIONS
      : new Set(pendingRequests.map((entry) => entry.sessionId))),
    [pendingRequests],
  );
}

/**
 * Used by AttentionToast (passing the router's viewed session id) and unit tests
 * to derive the newest unanswered, undismissed request outside the active view.
 */
export function useLatestAttentionNotice(viewedSessionId?: string | null): AttentionNotice | null {
  const { pendingRequests, dismissedKeys } = useContext(PermissionAttentionContext);
  const resolvedViewedSessionId = viewedSessionId === undefined
    ? readViewedSessionId()
    : viewedSessionId;

  return useMemo(() => {
    for (let index = pendingRequests.length - 1; index >= 0; index -= 1) {
      const candidate = pendingRequests[index];
      if (candidate.sessionId === resolvedViewedSessionId) {
        continue;
      }
      if (dismissedKeys.has(requestKey(candidate.sessionId, candidate.requestId))) {
        continue;
      }
      return candidate;
    }
    return null;
  }, [dismissedKeys, pendingRequests, resolvedViewedSessionId]);
}

/** Used by AttentionToast to hide the toast card without marking the prompt answered. */
export function useDismissAttentionNotice(): (requestId: string, excludedSessionId?: string | null) => void {
  return useContext(PermissionAttentionContext).dismissNotice;
}
