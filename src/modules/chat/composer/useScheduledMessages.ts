import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '@/shared/api';
import type { ScheduledMessage, ServerEvent } from '@/shared/types';

/**
 * The messages queued to be sent to one session later.
 *
 * Fetched when the session is opened and read again whenever the server
 * announces a change to that session's list (`scheduled_messages_changed`).
 * The list changes without this client doing anything: the server's timer
 * sends a message, or records why it could not, and another tab or device
 * can schedule or cancel one. A reconnect reads it again too, because an
 * announcement sent while the socket was down is lost.
 *
 * `subscribe` is the websocket context's. A caller that leaves it out still
 * gets the list, read on open and after its own schedule or cancel, but not
 * the live updates.
 */
export function useScheduledMessages(
  sessionId: string | null,
  subscribe?: (listener: (event: ServerEvent) => void) => () => void,
) {
  const [scheduledMessages, setScheduledMessages] = useState<ScheduledMessage[]>([]);
  // Which session the list on screen belongs to. A fetch that resolves after
  // the user has moved on must not put the old session's banner on the new one.
  const activeSessionRef = useRef(sessionId);
  // Numbers each list request so only the newest answer is shown. A message
  // that fails right after it is claimed announces two changes back to back,
  // and the older answer arriving last would put the earlier state back.
  const latestRequestRef = useRef(0);

  const refresh = useCallback(async () => {
    // No session means nothing to fetch; the render-time reset below already
    // cleared whatever the previous session had on screen.
    if (!sessionId) {
      return;
    }

    const request = ++latestRequestRef.current;
    try {
      const response = await api.scheduledMessages.list(sessionId);
      const payload = await response.json();
      if (activeSessionRef.current !== sessionId || request !== latestRequestRef.current) {
        return;
      }
      setScheduledMessages(Array.isArray(payload?.data) ? payload.data : []);
    } catch (error) {
      console.error('Failed to load scheduled messages:', error);
    }
  }, [sessionId]);

  // Cleared during the switch render, not by the fetch that follows: the
  // previous session's banner must never paint over the new session, not even
  // for the frame before an effect could run.
  const [renderedSessionId, setRenderedSessionId] = useState(sessionId);
  if (renderedSessionId !== sessionId) {
    setRenderedSessionId(sessionId);
    setScheduledMessages([]);
  }

  useEffect(() => {
    activeSessionRef.current = sessionId;
    void refresh();
  }, [refresh, sessionId]);

  useEffect(() => {
    // No socket to listen on: the list stays as last read, as it did before
    // the server announced changes.
    if (!subscribe) {
      return;
    }

    return subscribe((event) => {
      if (
        event.kind === 'websocket_reconnected'
        || (event.kind === 'scheduled_messages_changed' && event.sessionId === sessionId)
      ) {
        void refresh();
      }
    });
  }, [refresh, sessionId, subscribe]);

  const schedule = useCallback(async (input: {
    content: string;
    scheduledFor: Date;
    options?: Record<string, unknown>;
  }) => {
    if (!sessionId) return false;

    try {
      const response = await api.scheduledMessages.create({
        sessionId,
        content: input.content,
        scheduledFor: input.scheduledFor.toISOString(),
        options: input.options,
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      await refresh();
      return true;
    } catch (error) {
      console.error('Failed to schedule message:', error);
      return false;
    }
  }, [refresh, sessionId]);

  const cancel = useCallback(async (id: string) => {
    try {
      await api.scheduledMessages.cancel(id);
    } catch (error) {
      console.error('Failed to cancel scheduled message:', error);
    }
    await refresh();
  }, [refresh]);

  return { scheduledMessages, schedule, cancel, refresh };
}
