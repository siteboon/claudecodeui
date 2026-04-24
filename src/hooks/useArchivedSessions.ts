import { useCallback, useSyncExternalStore } from 'react';

const STORAGE_KEY = 'archived-sessions';
const LEGACY_STORAGE_KEY = 'hidden-sessions';

let cached: Set<string> | null = null;
const listeners = new Set<() => void>();

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

function emit() {
  for (const listener of listeners) listener();
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e: StorageEvent) => {
    if (e.key === STORAGE_KEY || e.key === LEGACY_STORAGE_KEY) {
      cached = readFromStorage();
      emit();
    }
  });
}

function getSnapshot(): Set<string> {
  if (!cached) cached = readFromStorage();
  return cached;
}

const EMPTY_SET: Set<string> = new Set();
function getServerSnapshot(): Set<string> {
  return EMPTY_SET;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useArchivedSessions() {
  const archived = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const toggleArchived = useCallback((sessionId: string) => {
    const current = cached ?? readFromStorage();
    const next = new Set(current);
    if (next.has(sessionId)) {
      next.delete(sessionId);
    } else {
      next.add(sessionId);
    }
    writeToStorage(next);
    cached = next;
    emit();
  }, []);

  const isArchived = useCallback(
    (sessionId: string) => archived.has(sessionId),
    [archived],
  );

  return { archived, toggleArchived, isArchived };
}
