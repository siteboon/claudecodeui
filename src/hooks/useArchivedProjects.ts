import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'archived-projects';

function readFromStorage(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((v) => typeof v === 'string'));
  } catch {
    return new Set();
  }
}

function writeToStorage(names: Set<string>) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(names)));
  } catch {
    // Ignore quota / privacy-mode errors
  }
}

export function useArchivedProjects() {
  const [archived, setArchived] = useState<Set<string>>(() => readFromStorage());

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setArchived(readFromStorage());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const toggleArchivedProject = useCallback((projectName: string) => {
    setArchived((prev) => {
      const next = new Set(prev);
      if (next.has(projectName)) {
        next.delete(projectName);
      } else {
        next.add(projectName);
      }
      writeToStorage(next);
      return next;
    });
  }, []);

  const isProjectArchived = useCallback(
    (projectName: string) => archived.has(projectName),
    [archived],
  );

  return { archived, toggleArchivedProject, isProjectArchived };
}
