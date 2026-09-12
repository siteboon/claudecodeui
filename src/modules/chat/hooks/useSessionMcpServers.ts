import { useCallback, useEffect, useMemo, useState } from 'react';

import { api } from '@/shared/api';
import type { LLMProvider, McpScope, ProviderMcpServer } from '@/shared/types';
import { subscribeToUserPreferences, readUserPreference, writeUserPreference } from '@/shared/userSettings';

type UseSessionMcpServersArgs = {
  provider: LLMProvider;
  /** Workspace whose project-scoped servers join the global ones. */
  projectPath: string | null;
  /** Panel open — the list is worth reading (the sources section uses it too). */
  enabled: boolean;
  /** Whether the runtime honors the disabled set; switches otherwise read-only. */
  canToggle: boolean;
};

/** Server shapes the MCP routes can answer with: grouped by scope, or flat. */
type McpServersPayload = {
  data?: {
    scopes?: Partial<Record<McpScope, ProviderMcpServer[]>>;
    servers?: ProviderMcpServer[];
  };
};

/**
 * Flattens either response shape to one list, deduplicated by name.
 *
 * The panel shows one row per recognizable server; the same name defined at
 * two scopes is one switch, so the first scope's entry wins and the
 * user-scoped definition is what the row describes.
 */
export function flattenMcpServers(payload: McpServersPayload): ProviderMcpServer[] {
  const grouped = payload.data?.scopes;
  const rows = grouped
    ? (['project', 'local', 'user'] as McpScope[]).flatMap((scope) => grouped[scope] ?? [])
    : payload.data?.servers ?? [];

  const byName = new Map<string, ProviderMcpServer>();
  for (const server of rows) {
    const name = typeof server?.name === 'string' ? server.name.trim() : '';
    if (name && !byName.has(name)) {
      byName.set(name, { ...server, name });
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The panel's MCP section data: every server visible to the provider, plus
 * the user's disabled-name set, plus the optimistic toggle.
 *
 * The disabled set is read through the shared user-preference mirror rather
 * than fetched from the settings route on its own: the server stores it under
 * the same key either way, so the mirror is already the freshest local copy,
 * and a change made on another device arrives through the preference
 * hydrate. Toggling writes both the server (immediately, for the runtime) and
 * the mirror (debounced), and a failed write rolls the row back.
 */
export function useSessionMcpServers({ provider, projectPath, enabled, canToggle }: UseSessionMcpServersArgs) {
  const [servers, setServers] = useState<ProviderMcpServer[]>([]);
  const [loading, setLoading] = useState(false);
  // Names the PUT is still in flight for, so the switch cannot be flipped
  // twice before the server answers.
  const [pendingNames, setPendingNames] = useState<Set<string>>(() => new Set());
  const [mirror, setMirror] = useState<string[]>(() =>
    readUserPreference<string[]>('mcpDisabledServers', []),
  );

  useEffect(() => {
    const sync = () => setMirror(readUserPreference<string[]>('mcpDisabledServers', []));
    return subscribeToUserPreferences(sync);
  }, []);

  useEffect(() => {
    if (!enabled) {
      setServers([]);
      return;
    }

    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const response = await api.providers.mcpServers(provider, {
          scope: undefined,
          workspacePath: projectPath ?? undefined,
        });
        if (!response.ok) {
          if (!cancelled) setServers([]);
          return;
        }
        const payload = (await response.json()) as McpServersPayload;
        if (!cancelled) setServers(flattenMcpServers(payload));
      } catch {
        if (!cancelled) setServers([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, provider, projectPath]);

  const disabledSet = useMemo(() => new Set(mirror), [mirror]);

  /** Flip one server's global switch; returns whether the server accepted it. */
  const toggleServer = useCallback(async (name: string): Promise<boolean> => {
    // A provider whose runtime ignores the set shows rows read-only: the
    // switch would change what the panel says without changing what runs.
    if (!canToggle) {
      return false;
    }
    const trimmed = name.trim();
    if (!trimmed || pendingNames.has(trimmed)) {
      return false;
    }

    const current = readUserPreference<string[]>('mcpDisabledServers', []);
    const wasDisabled = current.includes(trimmed);
    const next = wasDisabled
      ? current.filter((entry) => entry !== trimmed)
      : [...current, trimmed];

    setPendingNames((pending) => new Set(pending).add(trimmed));
    // Optimistic: the row flips now and the mirror follows, so the next turn's
    // panel already reads the new truth even before the PUT resolves.
    writeUserPreference('mcpDisabledServers', next);

    try {
      const response = await api.settings.saveMcpDisabledServers(next);
      if (!response.ok) {
        throw new Error(`mcp-disabled-servers PUT ${response.status}`);
      }
      // Confirm with the server's normalized list rather than the local one.
      const payload = (await response.json()) as { servers?: string[] };
      writeUserPreference('mcpDisabledServers', payload.servers ?? next);
      return true;
    } catch {
      // Roll the row (and the mirror, and thus any other component reading it)
      // back to what the server still believes.
      writeUserPreference('mcpDisabledServers', current);
      return false;
    } finally {
      setPendingNames((pending) => {
        const copy = new Set(pending);
        copy.delete(trimmed);
        return copy;
      });
    }
  }, [pendingNames, canToggle]);

  return { servers, loading, disabledSet, toggleServer, pendingNames, canToggle };
}
