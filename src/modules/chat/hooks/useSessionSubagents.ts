import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '@/shared/api';
import type { LLMProvider, SubagentSummary } from '@/shared/types';

/** How long a roster with a running agent waits before asking the server again. */
const RUNNING_POLL_MS = 5_000;

type UseSessionSubagentsArgs = {
  provider: LLMProvider;
  /** App session id; null while a brand-new conversation has no id yet. */
  sessionId: string | null;
  /** The panel is open — a closed panel never polls. */
  enabled: boolean;
  /** Provider integration answers the roster endpoint. */
  supportsInsights: boolean;
  /** The parent conversation is streaming right now. */
  parentRunning: boolean;
};

type SessionSubagentsState = {
  subagents: SubagentSummary[];
  loading: boolean;
  /** Re-pull the roster now (retry after an error, or after the run ends). */
  refresh: () => void;
};

/**
 * The info panel's roster of the session's spawned agents.
 *
 * The server composes each row from the CLI's subagents directory plus the
 * parent's task notifications, so the list survives reloads; polling only
 * matters while something runs. Once every row is terminal the timer stops
 * and only explicit refreshes (or the parent's run ending) re-read — a
 * crashed run's leftover then settles within one poll instead of spinning
 * forever. Realtime per-row streaming does NOT come from here; the modal
 * derives it from the parent's live message slot.
 */
export function useSessionSubagents({
  provider,
  sessionId,
  enabled,
  supportsInsights,
  parentRunning,
}: UseSessionSubagentsArgs): SessionSubagentsState {
  const [subagents, setSubagents] = useState<SubagentSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  const refresh = useCallback(() => setReloadToken((token) => token + 1), []);

  // Clearing is synchronous with the session identity: showing the previous
  // session's roster for one frame after a switch reads as a wrong answer.
  const lastKeyRef = useRef<string | null>(null);
  const key = enabled && supportsInsights ? `${provider}:${sessionId ?? ''}` : null;
  if (key !== lastKeyRef.current) {
    lastKeyRef.current = key;
    if (subagents.length > 0) setSubagents([]);
  }

  useEffect(() => {
    if (!key || !sessionId) {
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const load = async (initial: boolean) => {
      if (initial) setLoading(true);
      try {
        const response = await api.providers.sessionSubagents(sessionId);
        if (!response.ok) {
          if (!cancelled && initial) setSubagents([]);
          return;
        }
        const payload = (await response.json()) as { data?: { subagents?: SubagentSummary[] } };
        if (cancelled) return;
        const next = payload.data?.subagents ?? [];
        setSubagents(next);
        // Only a running row justifies the next automatic read; the parent's
        // own run ending triggers a refresh from the outside as well.
        if (next.some((entry) => entry.status === 'running')) {
          timer = setTimeout(() => void load(false), RUNNING_POLL_MS);
        }
      } catch {
        // Keep the last known roster; a transient failure should not blank the panel.
      } finally {
        if (!cancelled && initial) setLoading(false);
      }
    };

    void load(true);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [key, sessionId, reloadToken]);

  // The heuristic that calls a fresh file "running" needs the parent's state
  // to settle; one re-read when the run flips false pins every row's truth.
  const wasRunningRef = useRef(false);
  useEffect(() => {
    if (wasRunningRef.current && !parentRunning) {
      refresh();
    }
    wasRunningRef.current = parentRunning;
  }, [parentRunning, refresh]);

  return { subagents, loading, refresh };
}
