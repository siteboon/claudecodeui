import { useCallback, useEffect, useState } from 'react';

import { api } from '@/shared/api';
import type { ScheduledMessage } from '@/shared/types';

/**
 * The messages queued to be sent to one session later.
 *
 * Scheduling is a server-side timer, so this is a plain fetch rather than
 * anything realtime: the list changes only when this client schedules or
 * cancels something, and it is refetched when the session is reopened.
 */
export function useScheduledMessages(sessionId: string | null) {
  const [scheduledMessages, setScheduledMessages] = useState<ScheduledMessage[]>([]);

  const refresh = useCallback(async () => {
    if (!sessionId) {
      setScheduledMessages([]);
      return;
    }

    try {
      const response = await api.scheduledMessages.list(sessionId);
      const payload = await response.json();
      setScheduledMessages(Array.isArray(payload?.data) ? payload.data : []);
    } catch (error) {
      console.error('Failed to load scheduled messages:', error);
    }
  }, [sessionId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

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
