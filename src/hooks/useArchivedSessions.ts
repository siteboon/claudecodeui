import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'archived-sessions';
const LEGACY_STORAGE_KEY = 'hidden-sessions';

function readFromStorage(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        return new Set(parsed.filter((v) => typeof v === 'string'));
      }
    }
    const legacyRaw = window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacyRaw) {
      const parsed = JSON.parse(legacyRaw) as unknown;
      if (Array.isArray(parsed)) {
        const migrated = new Set(parsed.filter((v) => typeof v === 'string'));
        writeToStorage(migrated);
        window.localStorage.removeItem(LEGACY_STORAGE_KEY);
        return migrated;
      }
    }
    return new Set();
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

export function useArchivedSessions() {
  const [archived, setArchived] = useState<Set<string>>(() => readFromStorage());

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY || e.key === LEGACY_STORAGE_KEY) {
        setArchived(readFromStorage());
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const toggleArchived = useCallback((sessionId: string) => {
    setArchived((prev) => {
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

  const isArchived = useCallback(
    (sessionId: string) => archived.has(sessionId),
    [archived],
  );

  return { archived, toggleArchived, isArchived };
}
