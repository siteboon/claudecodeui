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
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bookmarks));
  }
  window.dispatchEvent(new Event('storage'));
}

export function useBookmarks(): {
  bookmarks: BookmarkedSession[];
  isBookmarked: (sessionId: string) => boolean;
  bookmarkSession: (session: BookmarkedSession) => void;
  removeBookmark: (sessionId: string) => void;
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
    (sessionId: string) => bookmarks.some(b => b.sessionId === sessionId),
    [bookmarks],
  );

  const bookmarkSession = useCallback((session: BookmarkedSession) => {
    setBookmarks(prev => {
      if (prev.some(b => b.sessionId === session.sessionId)) return prev;
      const next = [session, ...prev];
      save(next);
      return next;
    });
  }, []);

  const removeBookmark = useCallback((sessionId: string) => {
    setBookmarks(prev => {
      const next = prev.filter(b => b.sessionId !== sessionId);
      save(next);
      return next;
    });
  }, []);

  const toggleBookmark = useCallback((session: BookmarkedSession) => {
    setBookmarks(prev => {
      const idx = prev.findIndex(b => b.sessionId === session.sessionId);
      let next: BookmarkedSession[];
      if (idx >= 0) {
        next = prev.filter(b => b.sessionId !== session.sessionId);
      } else {
        next = [session, ...prev];
      }
      save(next);
      return next;
    });
  }, []);

  return { bookmarks, isBookmarked, bookmarkSession, removeBookmark, toggleBookmark };
}
