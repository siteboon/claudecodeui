/**
 * Starred sessions — localStorage-backed, no backend.
 *
 * State is a `Set<string>` of session IDs. Subscribers are notified via a
 * custom DOM event so multiple React components stay in sync within the tab,
 * and via the `storage` event so other tabs of the same origin pick up changes.
 */

const STORAGE_KEY = 'starred-sessions';
const CHANGE_EVENT = 'starred-sessions:change';

const isBrowser = typeof window !== 'undefined' && typeof localStorage !== 'undefined';

function read(): Set<string> {
  if (!isBrowser) return new Set();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((value) => typeof value === 'string'));
  } catch {
    return new Set();
  }
}

function write(ids: Set<string>): void {
  if (!isBrowser) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(ids)));
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
  } catch {
    // Storage quota errors are non-fatal — the in-memory set still works.
  }
}

export function getStarredSessions(): Set<string> {
  return read();
}

export function isSessionStarred(sessionId: string): boolean {
  return read().has(sessionId);
}

export function toggleSessionStar(sessionId: string): boolean {
  const ids = read();
  const wasStarred = ids.has(sessionId);
  if (wasStarred) {
    ids.delete(sessionId);
  } else {
    ids.add(sessionId);
  }
  write(ids);
  return !wasStarred;
}

export function removeSessionStar(sessionId: string): void {
  const ids = read();
  if (!ids.has(sessionId)) return;
  ids.delete(sessionId);
  write(ids);
}

/** Subscribes to changes — fires for same-tab edits AND cross-tab via `storage`. */
export function subscribeToStarredSessions(listener: () => void): () => void {
  if (!isBrowser) return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) listener();
  };
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener('storage', onStorage);
  };
}
