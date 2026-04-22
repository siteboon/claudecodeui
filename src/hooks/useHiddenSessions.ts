import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'hidden-sessions';

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

function writeToStorage(ids: Set<string>) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(ids)));
  } catch {
    // Ignore quota / privacy-mode errors
  }
}

export function useHiddenSessions() {
  const [hidden, setHidden] = useState<Set<string>>(() => readFromStorage());

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setHidden(readFromStorage());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const toggleHidden = useCallback((sessionId: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(sessionId)) {
        next.delete(sessionId);
      } else {
        next.add(sessionId);
      }
      writeToStorage(next);
      return next;
    });
  }, []);

  const isHidden = useCallback(
    (sessionId: string) => hidden.has(sessionId),
    [hidden],
  );

  return { hidden, toggleHidden, isHidden };
}
