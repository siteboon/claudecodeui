import { useCallback, useEffect, useState } from 'react';

export type BookmarkedSession = {
  sessionId: string;
  projectId: string;
  projectDisplayName: string;
  sessionSummary: string;
  provider: string;
  bookmarkedAt: string;
};

const STORAGE_KEY = 'cloudcli_bookmarks';

function load(): BookmarkedSession[] {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function save(bookmarks: BookmarkedSession[]) {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(bookmarks));
    }
    window.dispatchEvent(new Event('storage'));
  } catch {
    // localStorage may fail in private browsing mode or when quota is exceeded
  }
}

function bookmarkKey(session: { projectId: string; sessionId: string; provider: string }): string {
  return `${session.projectId}::${session.sessionId}::${session.provider}`;
}

export function useBookmarks(): {
  bookmarks: BookmarkedSession[];
  isBookmarked: (session: { sessionId: string; projectId: string; provider: string }) => boolean;
  bookmarkSession: (session: BookmarkedSession) => void;
  removeBookmark: (session: { sessionId: string; projectId: string; provider: string }) => void;
  toggleBookmark: (session: BookmarkedSession) => void;
} {
  const [bookmarks, setBookmarks] = useState<BookmarkedSession[]>(load);

  // Listen for changes from other tabs or in-component mutations
  useEffect(() => {
    const handler = () => setBookmarks(load());
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, []);

  const isBookmarked = useCallback(
    (session: { sessionId: string; projectId: string; provider: string }) =>
      bookmarks.some(b => bookmarkKey(b) === bookmarkKey(session)),
    [bookmarks],
  );

  const bookmarkSession = useCallback((session: BookmarkedSession) => {
    setBookmarks(prev => {
      if (prev.some(b => bookmarkKey(b) === bookmarkKey(session))) return prev;
      const next = [session, ...prev];
      save(next);
      return next;
    });
  }, []);

  const removeBookmark = useCallback((session: { sessionId: string; projectId: string; provider: string }) => {
    setBookmarks(prev => {
      const next = prev.filter(b => bookmarkKey(b) !== bookmarkKey(session));
      save(next);
      return next;
    });
  }, []);

  const toggleBookmark = useCallback((session: BookmarkedSession) => {
    setBookmarks(prev => {
      const idx = prev.findIndex(b => bookmarkKey(b) === bookmarkKey(session));
      let next: BookmarkedSession[];
      if (idx >= 0) {
        next = prev.filter(b => bookmarkKey(b) !== bookmarkKey(session));
      } else {
        next = [session, ...prev];
      }
      save(next);
      return next;
    });
  }, []);

  return { bookmarks, isBookmarked, bookmarkSession, removeBookmark, toggleBookmark };
}
