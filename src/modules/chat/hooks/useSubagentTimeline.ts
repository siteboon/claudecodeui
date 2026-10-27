import { useEffect, useMemo, useRef, useState } from 'react';

import { api, readApiJson } from '@/shared/api';
import type { SessionSubagent, SubagentActivity, SubagentTimelinePage } from '@/shared/types';

/** How often the timeline of a running agent is re-read. */
const TIMELINE_POLL_MS = 2_000;

/** What the reads of one agent's timeline add up to. */
type LoadedTimeline = {
  /** The chat and agent the reads were for. */
  key: string;
  agent: SessionSubagent;
  prompt?: string;
  /** Entries by their position in the whole timeline; a first read starts partway into a long one. */
  entries: Map<number, SubagentActivity>;
  activityCount: number;
  /** When the last read landed (epoch ms), to weigh its word on the agent against the list's. */
  readAt: number;
};

/**
 * One subagent's timeline for the agents panel, kept current while the agent
 * runs: the first read brings the newest entries, each later read only what
 * changed since (the server's cursor), merged in by position.
 *
 * `listSaysRunning` is the panel list's word on the agent. Reads stop once a
 * read says the agent is done, and start again when the list says it runs —
 * SendMessage can bring a finished agent back.
 */
export function useSubagentTimeline(sessionId: string | null, agentId: string | null, listSaysRunning: boolean) {
  // The merged reads, for the agent they were for; a read for another agent replaces them.
  const [loaded, setLoaded] = useState<LoadedTimeline | null>(null);
  // Why the last read failed, for the agent it was for; the entries read
  // before stay on screen.
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const cursorRef = useRef<{ key: string; cursor: string } | null>(null);
  const key = sessionId && agentId ? `${sessionId}:${agentId}` : null;

  useEffect(() => {
    if (!sessionId || !agentId) {
      return undefined;
    }
    const readKey = `${sessionId}:${agentId}`;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const read = async () => {
      let keepReading = listSaysRunning;
      try {
        const cursor = cursorRef.current?.key === readKey ? cursorRef.current.cursor : undefined;
        const { data: page } = await readApiJson<{ data: SubagentTimelinePage }>(
          await api.subagentTimeline(sessionId, agentId, cursor || undefined),
        );
        if (cancelled) {
          return;
        }
        cursorRef.current = { key: readKey, cursor: page.cursor };
        setLoaded((previous) => {
          const entries = new Map(page.reset || previous?.key !== readKey ? [] : previous.entries);
          for (const { index, ...entry } of page.entries) {
            entries.set(index, entry);
          }
          return {
            key: readKey,
            agent: page.agent,
            prompt: page.prompt ?? (previous?.key === readKey ? previous.prompt : undefined),
            entries,
            activityCount: page.activityCount,
            readAt: Date.now(),
          };
        });
        setFailure(null);
        keepReading = page.agent.status === 'running';
      } catch (readError) {
        if (cancelled) {
          return;
        }
        // A fresh agent's transcript can lag its start by a moment.
        setFailure({ key: readKey, message: readError instanceof Error ? readError.message : String(readError) });
      }
      if (!cancelled && keepReading) {
        timer = setTimeout(() => void read(), TIMELINE_POLL_MS);
      }
    };
    void read();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [sessionId, agentId, listSaysRunning]);

  const current = loaded && loaded.key === key ? loaded : null;
  const error = failure && failure.key === key ? failure.message : null;
  const activity = useMemo(
    () => (current ? [...current.entries.entries()].sort(([left], [right]) => left - right).map(([, entry]) => entry) : []),
    [current],
  );

  return {
    agent: current?.agent ?? null,
    prompt: current?.prompt,
    activity,
    activityCount: current?.activityCount ?? 0,
    readAt: current?.readAt ?? 0,
    error,
    loading: !current && !error,
  };
}
