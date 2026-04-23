import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useWebSocket } from '../../../contexts/WebSocketContext';

export type TopicColor = 'mint' | 'peach' | 'lavender' | 'butter' | 'blush' | 'sky';

export type TopicMethod = 'haiku' | 'hdbscan' | 'manual';

export interface Topic {
  /** Stable id across re-fetches: `${projectKey}::${name}`. */
  id: string;
  /** Human-readable label. */
  name: string;
  /** Pastel accent chosen on the server (same name within a project always same pastel). */
  color: TopicColor;
  /** Claude project slug that owns this topic. */
  projectKey: string;
  /** Server-provided count of sessions assigned to this topic (0 for local ghosts). */
  sessionCount: number;
  /** True when this topic exists only in client memory (user typed a name but hasn't assigned a session yet). */
  isLocal?: boolean;
}

export interface TopicAssignment {
  topicId: string;
  topic: string;
  accent: TopicColor | null;
  method: TopicMethod;
}

export interface TopicStorageAPI {
  /** All topics across all projects. Consumers filter by projectKey. */
  topics: Topic[];
  /** sessionId → topic assignment. */
  assignments: Record<string, TopicAssignment>;
  /** projectKey (slug) → currently active topic id (or null = show all). */
  activeTopicByProject: Record<string, string | null>;
  /** True while the initial fetch is in flight. */
  loading: boolean;
  /** Last server-side error message, if any. */
  error: string | null;
  createTopic: (projectKey: string, name: string, color?: TopicColor) => Topic;
  renameTopic: (topicId: string, name: string) => void;
  deleteTopic: (topicId: string) => void;
  assignSessionToTopic: (sessionId: string, projectKey: string, topicId: string | null) => Promise<void>;
  setActiveTopic: (projectKey: string, topicId: string | null) => void;
  getTopicForSession: (sessionId: string) => Topic | null;
  refresh: () => Promise<void>;
}

const STORAGE_KEY = 'dispatch.sidebar.activeTopicByProject.v1';
const COLOR_CYCLE: TopicColor[] = ['sky', 'mint', 'peach', 'lavender', 'butter', 'blush'];
const ACCENT_SET: ReadonlySet<TopicColor> = new Set(COLOR_CYCLE);

function isTopicColor(value: unknown): value is TopicColor {
  return typeof value === 'string' && ACCENT_SET.has(value as TopicColor);
}

function topicId(projectKey: string, name: string): string {
  return `${projectKey}::${name}`;
}

function readActiveMap(): Record<string, string | null> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as Record<string, string | null>;
  } catch {
    return {};
  }
}

function writeActiveMap(map: Record<string, string | null>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* quota / private mode — no-op */
  }
}

function authHeaders(): HeadersInit {
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('auth-token') : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

type ServerTopicSummary = { name: string; accent: string | null; sessionCount: number; firstSeen: number };

type ServerProjectBlock = {
  topics: ServerTopicSummary[];
  assignments: Record<string, { topic: string; accent: string | null; method: TopicMethod }>;
};

type ServerTopicsResponse = {
  byProject: Record<string, ServerProjectBlock>;
};

interface InternalState {
  serverTopics: Topic[];
  localTopics: Topic[];
  assignments: Record<string, TopicAssignment>;
  activeTopicByProject: Record<string, string | null>;
}

const EMPTY_STATE: InternalState = {
  serverTopics: [],
  localTopics: [],
  assignments: {},
  activeTopicByProject: {},
};

function normalizeServerData(data: ServerTopicsResponse): {
  topics: Topic[];
  assignments: Record<string, TopicAssignment>;
} {
  const topics: Topic[] = [];
  const assignments: Record<string, TopicAssignment> = {};
  const byProject = data?.byProject || {};
  for (const projectKey of Object.keys(byProject)) {
    const block = byProject[projectKey];
    if (!block) continue;
    for (const t of block.topics || []) {
      topics.push({
        id: topicId(projectKey, t.name),
        name: t.name,
        color: isTopicColor(t.accent) ? t.accent : 'sky',
        projectKey,
        sessionCount: t.sessionCount,
      });
    }
    const projectAssignments = block.assignments || {};
    for (const sessionId of Object.keys(projectAssignments)) {
      const a = projectAssignments[sessionId];
      assignments[sessionId] = {
        topicId: topicId(projectKey, a.topic),
        topic: a.topic,
        accent: isTopicColor(a.accent) ? a.accent : null,
        method: a.method,
      };
    }
  }
  return { topics, assignments };
}

export function useServerTopics(): TopicStorageAPI {
  const [state, setState] = useState<InternalState>(EMPTY_STATE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const { latestMessage } = useWebSocket();

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/topics', { headers: authHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: ServerTopicsResponse = await res.json();
      const { topics, assignments } = normalizeServerData(data);
      if (!mountedRef.current) return;
      setError(null);
      setState((prev) => {
        // Preserve local ghosts that haven't been persisted yet.
        const serverIds = new Set(topics.map((t) => t.id));
        const survivingLocals = prev.localTopics.filter((t) => !serverIds.has(t.id));
        return {
          serverTopics: topics,
          localTopics: survivingLocals,
          assignments,
          activeTopicByProject: prev.activeTopicByProject,
        };
      });
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : 'Failed to load topics');
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  // Initial fetch + localStorage hydrate.
  useEffect(() => {
    mountedRef.current = true;
    const active = readActiveMap();
    setState((prev) => ({ ...prev, activeTopicByProject: active }));
    refresh();
    return () => {
      mountedRef.current = false;
    };
  }, [refresh]);

  // Re-fetch whenever projects_updated fires (topic rows arrive shortly after titler/clusterer writes).
  useEffect(() => {
    if (!latestMessage) return;
    const type = (latestMessage as { type?: string })?.type;
    if (type === 'projects_updated' || type === 'topics_updated') {
      refresh();
    }
  }, [latestMessage, refresh]);

  // Persist active-topic selection.
  useEffect(() => {
    writeActiveMap(state.activeTopicByProject);
  }, [state.activeTopicByProject]);

  const mergedTopics = useMemo<Topic[]>(() => {
    const byId = new Map<string, Topic>();
    for (const t of state.serverTopics) byId.set(t.id, t);
    for (const t of state.localTopics) if (!byId.has(t.id)) byId.set(t.id, t);
    return Array.from(byId.values());
  }, [state.serverTopics, state.localTopics]);

  const createTopic = useCallback(
    (projectKey: string, name: string, color?: TopicColor): Topic => {
      const trimmed = name.trim();
      if (!projectKey || !trimmed) {
        throw new Error('createTopic requires projectKey and name');
      }
      const id = topicId(projectKey, trimmed);
      const existing = mergedTopics.find((t) => t.id === id);
      if (existing) return existing;
      const usedColors = new Set(
        mergedTopics.filter((t) => t.projectKey === projectKey).map((t) => t.color),
      );
      const fallback =
        COLOR_CYCLE.find((c) => !usedColors.has(c)) ||
        COLOR_CYCLE[mergedTopics.length % COLOR_CYCLE.length];
      const resolved: Topic = {
        id,
        name: trimmed,
        color: color || fallback,
        projectKey,
        sessionCount: 0,
        isLocal: true,
      };
      setState((prev) => ({
        ...prev,
        localTopics: [...prev.localTopics, resolved],
      }));
      return resolved;
    },
    [mergedTopics],
  );

  const renameTopic = useCallback(
    (_topicId: string, _name: string): void => {
      // Phase 4 does not support server-side topic renaming — topic names are
      // derived from conversation_topics rows. Renaming would require rewriting
      // every row with the old name to the new one. Defer to a future pass.
      console.warn('[useServerTopics] renameTopic is not supported in Phase 4');
    },
    [],
  );

  const deleteTopic = useCallback((targetId: string): void => {
    // Only local ghosts can be deleted directly. Server-backed topics disappear
    // naturally once all sessions assigned to them are cleared or re-tagged.
    setState((prev) => ({
      ...prev,
      localTopics: prev.localTopics.filter((t) => t.id !== targetId),
      activeTopicByProject: Object.fromEntries(
        Object.entries(prev.activeTopicByProject).map(([k, v]) => [k, v === targetId ? null : v]),
      ),
    }));
  }, []);

  const assignSessionToTopic = useCallback(
    async (sessionId: string, projectKey: string, topicIdValue: string | null): Promise<void> => {
      let topicName: string | null = null;
      if (topicIdValue) {
        const found = mergedTopics.find((t) => t.id === topicIdValue);
        if (!found) return;
        topicName = found.name;
      }
      // Optimistic local update so drag-drop feels instant.
      setState((prev) => {
        const assignments = { ...prev.assignments };
        if (topicName === null) {
          delete assignments[sessionId];
        } else {
          const t = mergedTopics.find((x) => x.id === topicIdValue);
          assignments[sessionId] = {
            topicId: topicIdValue!,
            topic: topicName,
            accent: t?.color ?? null,
            method: 'manual',
          };
        }
        return { ...prev, assignments };
      });

      try {
        const res = await fetch('/api/topics/assign', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify({
            sessionId,
            projectKey,
            topic: topicName,
          }),
        });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Topic assignment failed');
        // Refresh to reconcile.
        refresh();
      } finally {
        // Always refresh so counts + accents stay authoritative.
        refresh();
      }
    },
    [mergedTopics, refresh],
  );

  const setActiveTopic = useCallback(
    (projectKey: string, topicIdValue: string | null): void => {
      setState((prev) => ({
        ...prev,
        activeTopicByProject: { ...prev.activeTopicByProject, [projectKey]: topicIdValue },
      }));
    },
    [],
  );

  const getTopicForSession = useCallback(
    (sessionId: string): Topic | null => {
      const assignment = state.assignments[sessionId];
      if (!assignment) return null;
      return mergedTopics.find((t) => t.id === assignment.topicId) ?? null;
    },
    [state.assignments, mergedTopics],
  );

  return {
    topics: mergedTopics,
    assignments: state.assignments,
    activeTopicByProject: state.activeTopicByProject,
    loading,
    error,
    createTopic,
    renameTopic,
    deleteTopic,
    assignSessionToTopic,
    setActiveTopic,
    getTopicForSession,
    refresh,
  };
}

export const __internal = { COLOR_CYCLE, topicId, normalizeServerData };
