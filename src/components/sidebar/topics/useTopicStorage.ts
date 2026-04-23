import { useState, useEffect, useCallback } from 'react';

export type TopicColor = 'mint' | 'peach' | 'lavender' | 'butter' | 'blush' | 'sky';

export interface Topic {
  id: string;
  name: string;
  color: TopicColor;
  createdAt: number;
}

export interface TopicStorageAPI {
  topics: Topic[];
  assignments: Record<string, string>;
  activeTopicByRepo: Record<string, string | null>;
  createTopic: (name: string, color?: TopicColor) => Topic;
  renameTopic: (topicId: string, name: string) => void;
  deleteTopic: (topicId: string) => void;
  assignSessionToTopic: (sessionId: string, topicId: string | null) => void;
  setActiveTopic: (repoGroup: string, topicId: string | null) => void;
  getTopicForSession: (sessionId: string) => Topic | null;
}

const STORAGE_KEY = 'dispatch.sidebar.topics.v1';
const COLOR_CYCLE: TopicColor[] = ['mint', 'peach', 'lavender', 'butter', 'blush', 'sky'];

interface PersistedState {
  topics: Topic[];
  assignments: Record<string, string>;
  activeTopicByRepo: Record<string, string | null>;
}

const EMPTY_STATE: PersistedState = {
  topics: [],
  assignments: {},
  activeTopicByRepo: {},
};

function readFromStorage(): PersistedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_STATE;
    const parsed = JSON.parse(raw);
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !Array.isArray(parsed.topics) ||
      typeof parsed.assignments !== 'object' ||
      typeof parsed.activeTopicByRepo !== 'object'
    ) {
      return EMPTY_STATE;
    }
    return parsed as PersistedState;
  } catch {
    return EMPTY_STATE;
  }
}

function writeToStorage(state: PersistedState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // localStorage unavailable (private mode, SSR, quota exceeded) — no-op
  }
}

export function useTopicStorage(): TopicStorageAPI {
  const [state, setState] = useState<PersistedState>(EMPTY_STATE);

  useEffect(() => {
    setState(readFromStorage());
  }, []);

  const update = useCallback((updater: (prev: PersistedState) => PersistedState) => {
    setState(prev => {
      const next = updater(prev);
      writeToStorage(next);
      return next;
    });
  }, []);

  const createTopic = useCallback((name: string, color?: TopicColor): Topic => {
    let created!: Topic;
    update(prev => {
      const resolvedColor = color ?? COLOR_CYCLE[prev.topics.length % COLOR_CYCLE.length];
      created = {
        id: crypto.randomUUID(),
        name,
        color: resolvedColor,
        createdAt: Date.now(),
      };
      return {
        ...prev,
        topics: [...prev.topics, created].sort((a, b) => a.createdAt - b.createdAt),
      };
    });
    return created;
  }, [update]);

  const renameTopic = useCallback((topicId: string, name: string): void => {
    update(prev => ({
      ...prev,
      topics: prev.topics.map(t => (t.id === topicId ? { ...t, name } : t)),
    }));
  }, [update]);

  const deleteTopic = useCallback((topicId: string): void => {
    update(prev => {
      const assignments = { ...prev.assignments };
      for (const sessionId of Object.keys(assignments)) {
        if (assignments[sessionId] === topicId) {
          delete assignments[sessionId];
        }
      }
      const activeTopicByRepo = { ...prev.activeTopicByRepo };
      for (const repo of Object.keys(activeTopicByRepo)) {
        if (activeTopicByRepo[repo] === topicId) {
          activeTopicByRepo[repo] = null;
        }
      }
      return {
        topics: prev.topics.filter(t => t.id !== topicId),
        assignments,
        activeTopicByRepo,
      };
    });
  }, [update]);

  const assignSessionToTopic = useCallback((sessionId: string, topicId: string | null): void => {
    update(prev => {
      const assignments = { ...prev.assignments };
      if (topicId === null) {
        delete assignments[sessionId];
      } else {
        assignments[sessionId] = topicId;
      }
      return { ...prev, assignments };
    });
  }, [update]);

  const setActiveTopic = useCallback((repoGroup: string, topicId: string | null): void => {
    update(prev => ({
      ...prev,
      activeTopicByRepo: { ...prev.activeTopicByRepo, [repoGroup]: topicId },
    }));
  }, [update]);

  const getTopicForSession = useCallback((sessionId: string): Topic | null => {
    const topicId = state.assignments[sessionId];
    if (!topicId) return null;
    return state.topics.find(t => t.id === topicId) ?? null;
  }, [state]);

  return {
    topics: state.topics,
    assignments: state.assignments,
    activeTopicByRepo: state.activeTopicByRepo,
    createTopic,
    renameTopic,
    deleteTopic,
    assignSessionToTopic,
    setActiveTopic,
    getTopicForSession,
  };
}
