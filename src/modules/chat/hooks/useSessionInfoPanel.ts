import { useCallback, useEffect, useState } from 'react';

import { api } from '@/shared/api';
import type { LLMProvider } from '@/shared/types';
import {
  readStoredSessionInfoPanelPrefs,
  withSectionCollapsed,
  type SessionInfoPanelPrefs,
  type SessionInfoPanelSection,
} from '@/shared/sessionInfoPanelPrefs';
import { writeUserPreference, subscribeToUserPreferences } from '@/shared/userSettings';

/** The provider's context-window snapshot; null when the CLI has no live handle. */
export type ContextInfoSnapshot = {
  totalTokens: number | null;
  maxTokens: number | null;
  percentage: number | null;
  model: string | null;
  categories: Array<{ name: string; tokens: number; kind: string }>;
  agents: Array<{ agentType: string; tokens: number }>;
  mcpTools: Array<{ name: string; serverName: string; tokens: number }>;
  memoryFiles: Array<{ path: string; tokens: number }>;
  slashCommands: { totalCommands: number; includedCommands: number } | null;
};

type UseSessionInfoPanelArgs = {
  provider: LLMProvider;
  /** App session id; null while a brand-new conversation has no id yet. */
  sessionId: string | null;
  /** Provider integration offers the subagent/context/CLI-backed sections. */
  supportsInsights: boolean;
};

/**
 * Owns the info panel's layout preferences and the REST reads it makes when
 * opened. Streamed data (tokenBudget, turnStats, merged messages) is NOT
 * fetched here — it already lives in session state, and the panel receives it
 * by props so both views update from the same source.
 *
 * Reading (contextInfo, MCP, skills) happens on open and on session/project
 * change; a closed panel never polls.
 */
export function useSessionInfoPanel({ provider, sessionId, supportsInsights }: UseSessionInfoPanelArgs) {
  const [prefs, setPrefs] = useState<SessionInfoPanelPrefs>(() => readStoredSessionInfoPanelPrefs());
  const [contextInfo, setContextInfo] = useState<ContextInfoSnapshot | null>(null);

  // Follow preference changes made elsewhere (another tab, the header button
  // before this panel mounted) through the shared change notification.
  useEffect(() => {
    const sync = () => setPrefs(readStoredSessionInfoPanelPrefs());
    return subscribeToUserPreferences(sync);
  }, []);

  const setOpen = useCallback((open: boolean) => {
    setPrefs((current) => {
      if (current.open === open) return current;
      const next = { ...current, open };
      writeUserPreference('sessionInfoPanel', next);
      return next;
    });
  }, []);

  const toggleSection = useCallback((section: SessionInfoPanelSection) => {
    setPrefs((current) => {
      const next = withSectionCollapsed(current, section, !current.collapsedSections[section]);
      writeUserPreference('sessionInfoPanel', next);
      return next;
    });
  }, []);

  // The CLI answers context questions only while it holds the session, so a
  // failed/absent answer simply means "fall back to streamed usage". Re-read
  // on session change and whenever the panel (re)opens.
  useEffect(() => {
    if (!prefs.open || !sessionId || !supportsInsights) {
      setContextInfo(null);
      return;
    }

    let cancelled = false;
    const load = async () => {
      try {
        const response = await api.providers.sessionContextInfo(sessionId);
        if (!response.ok) {
          if (!cancelled) setContextInfo(null);
          return;
        }

        const payload = (await response.json()) as { data?: ContextInfoSnapshot | null };
        if (!cancelled) {
          setContextInfo(payload.data ?? null);
        }
      } catch {
        if (!cancelled) setContextInfo(null);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [prefs.open, sessionId, provider, supportsInsights]);

  return { prefs, setOpen, toggleSection, contextInfo };
}
