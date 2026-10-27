import { useCallback, useEffect, useRef, useState } from 'react';

import { api, readApiJson } from '@/shared/api';
import type { BackgroundTaskSummary, ServerEvent, SessionBackgroundWork } from '@/shared/types';

type UseAgentsPanelArgs = {
  sessionId: string | null;
  /** Only Claude chats keep background work the server can read. */
  enabled: boolean;
  /** The chat's running tasks from the activity map, which say an agent started without a read. */
  runningTasks?: BackgroundTaskSummary[];
  subscribe: (listener: (event: ServerEvent) => void) => () => void;
};

/** How often the open panel re-reads the chat's work while an agent runs. */
const RUNNING_POLL_MS = 3_000;
/** How often it does while only heartbeats wait in a live process. */
const HEARTBEAT_POLL_MS = 20_000;
/** A task event is followed by a read this much later, so a burst of them costs one. */
const EVENT_READ_DELAY_MS = 400;
/** From this width (Tailwind's `lg`) the panel sits beside the chat instead of covering it. */
const SIDE_BY_SIDE_MIN_WIDTH = 1024;

/**
 * The agents panel beside the chat: whether it is open, the chat's subagents
 * and heartbeats as the server last read them, and the agent open in it.
 *
 * The open panel re-reads while anything runs and on the chat's task events.
 * It opens by itself when an agent starts in a chat on a wide screen —
 * subagents work on the side, so their live view belongs beside the chat —
 * unless the user closed it for that chat.
 */
export function useAgentsPanel({ sessionId, enabled, runningTasks, subscribe }: UseAgentsPanelArgs) {
  // Whether the panel is showing; one flag for every chat, like the side chat's.
  const [isOpen, setIsOpen] = useState(false);
  // The last read, with the chat it belongs to (so a read for the chat left
  // behind is never shown for the one on screen) and when it landed.
  const [loaded, setLoaded] = useState<{ sessionId: string; work: SessionBackgroundWork; readAt: number } | null>(null);
  // Why the last read failed, for the chat it was for; shown until a read succeeds.
  const [failure, setFailure] = useState<{ sessionId: string; message: string } | null>(null);
  // The agent whose timeline the panel shows, for the chat it was picked in;
  // another chat opens on its list.
  const [selection, setSelection] = useState<{ sessionId: string; agentId: string } | null>(null);
  const closedByUserRef = useRef(new Set<string>());
  const readSequenceRef = useRef(0);

  const current = loaded && loaded.sessionId === sessionId ? loaded : null;
  const work = current?.work ?? null;
  const error = failure && failure.sessionId === sessionId ? failure.message : null;
  const selectedAgentId = selection && selection.sessionId === sessionId ? selection.agentId : null;
  const runningAgentCount = (runningTasks ?? []).filter((task) => task.taskType === 'local_agent').length;
  const anyAgentRunning = runningAgentCount > 0 || Boolean(work?.subagents.some((agent) => agent.status === 'running'));

  const refresh = useCallback(async () => {
    if (!enabled || !sessionId) {
      return;
    }
    const sequence = readSequenceRef.current + 1;
    readSequenceRef.current = sequence;
    try {
      const payload = await readApiJson<{ data: SessionBackgroundWork }>(await api.sessionBackgroundWork(sessionId));
      // A later read has been asked for; it answers instead.
      if (sequence !== readSequenceRef.current) {
        return;
      }
      setLoaded({ sessionId, work: payload.data, readAt: Date.now() });
      setFailure(null);
    } catch (readError) {
      if (sequence === readSequenceRef.current) {
        setFailure({ sessionId, message: readError instanceof Error ? readError.message : String(readError) });
      }
    }
  }, [enabled, sessionId]);

  // An agent starting in a chat on a wide screen opens the panel.
  useEffect(() => {
    if (!enabled || !sessionId || isOpen || runningAgentCount === 0 || closedByUserRef.current.has(sessionId)) {
      return;
    }
    if (typeof window !== 'undefined' && window.innerWidth < SIDE_BY_SIDE_MIN_WIDTH) {
      return;
    }
    setIsOpen(true);
  }, [enabled, sessionId, isOpen, runningAgentCount]);

  const pollMs = anyAgentRunning
    ? RUNNING_POLL_MS
    : work?.processLive && work.heartbeats.length > 0 ? HEARTBEAT_POLL_MS : null;

  // Read on open and for a new chat; re-read while something runs. A hidden
  // page skips its turns.
  useEffect(() => {
    if (!isOpen || !enabled || !sessionId) {
      return undefined;
    }
    void refresh();
    if (pollMs === null) {
      return undefined;
    }
    const timer = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState !== 'hidden') {
        void refresh();
      }
    }, pollMs);
    return () => clearInterval(timer);
  }, [isOpen, enabled, sessionId, pollMs, refresh]);

  // A task starting, reporting or stopping, or a turn ending, changes the list.
  useEffect(() => {
    if (!isOpen || !enabled || !sessionId) {
      return undefined;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = subscribe((event) => {
      if (event.sessionId !== sessionId || (event.kind !== 'task_status' && event.kind !== 'complete')) {
        return;
      }
      clearTimeout(timer);
      timer = setTimeout(() => void refresh(), EVENT_READ_DELAY_MS);
    });
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [isOpen, enabled, sessionId, subscribe, refresh]);

  const selectAgent = useCallback((agentId: string | null) => {
    setSelection(agentId && sessionId ? { sessionId, agentId } : null);
  }, [sessionId]);

  const open = useCallback((agentId?: string) => {
    if (sessionId) {
      closedByUserRef.current.delete(sessionId);
    }
    if (agentId !== undefined) {
      selectAgent(agentId);
    }
    setIsOpen(true);
  }, [selectAgent, sessionId]);

  const close = useCallback(() => {
    if (sessionId) {
      closedByUserRef.current.add(sessionId);
    }
    setIsOpen(false);
  }, [sessionId]);

  return {
    isOpen,
    open,
    close,
    work,
    workReadAt: current?.readAt ?? 0,
    error,
    refresh,
    runningAgentCount: work ? work.subagents.filter((agent) => agent.status === 'running').length : runningAgentCount,
    selectedAgentId,
    selectAgent,
  };
}
