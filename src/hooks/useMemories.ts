import { useState, useCallback, useMemo } from 'react';

export type Memory = {
  id: string;
  content: string;
  createdAt: string;
  enabled: boolean;
};

const STORAGE_KEY = 'memories';

function loadMemories(): Memory[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveMemories(memories: Memory[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(memories));
}

export function useMemories() {
  const [memories, setMemories] = useState<Memory[]>(loadMemories);

  const persist = useCallback((next: Memory[]) => {
    setMemories(next);
    saveMemories(next);
  }, []);

  const addMemory = useCallback((content: string) => {
    const memory: Memory = {
      id: crypto.randomUUID(),
      content,
      createdAt: new Date().toISOString(),
      enabled: true,
    };
    setMemories((prev) => {
      const next = [...prev, memory];
      saveMemories(next);
      return next;
    });
  }, []);

  const updateMemory = useCallback((id: string, updates: Partial<Pick<Memory, 'content' | 'enabled'>>) => {
    setMemories((prev) => {
      const next = prev.map((m) => (m.id === id ? { ...m, ...updates } : m));
      saveMemories(next);
      return next;
    });
  }, []);

  const deleteMemory = useCallback((id: string) => {
    setMemories((prev) => {
      const next = prev.filter((m) => m.id !== id);
      saveMemories(next);
      return next;
    });
  }, []);

  const toggleMemory = useCallback((id: string) => {
    setMemories((prev) => {
      const next = prev.map((m) => (m.id === id ? { ...m, enabled: !m.enabled } : m));
      saveMemories(next);
      return next;
    });
  }, []);

  const enabledMemoriesText = useMemo(
    () => memories.filter((m) => m.enabled).map((m) => m.content).join('\n'),
    [memories],
  );

  return { memories, addMemory, updateMemory, deleteMemory, toggleMemory, enabledMemoriesText };
}
