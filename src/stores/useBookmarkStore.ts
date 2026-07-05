import { useCallback, useEffect, useState } from 'react';

import type { LLMProvider, Project } from '../types/app';

export type BookmarkIdentity = {
  projectId: string;
  sessionId: string;
  provider: LLMProvider;
};

export type BookmarkedSession = BookmarkIdentity & {
  projectDisplayName: string;
  sessionSummary: string;
  bookmarkedAt: string;
};

const STORAGE_KEY = 'cloudcli.sessionBookmarks';

export function getBookmarkKey(session: BookmarkIdentity): string {
  return `${session.projectId}::${session.provider}::${session.sessionId}`;
}

function readBookmarks(): BookmarkedSession[] {
  try {
    if (typeof localStorage === 'undefined') {
      return [];
    }

    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter(isBookmarkedSession) : [];
  } catch {
    return [];
  }
}

function writeBookmarks(bookmarks: BookmarkedSession[]): void {
  try {
    if (typeof localStorage === 'undefined') {
      return;
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(bookmarks));
    window.dispatchEvent(new CustomEvent('cloudcli:bookmarks-changed'));
  } catch {
    // localStorage may be unavailable or full.
  }
}

function isBookmarkedSession(value: unknown): value is BookmarkedSession {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<BookmarkedSession>;
  return (
    typeof candidate.projectId === 'string'
    && typeof candidate.sessionId === 'string'
    && typeof candidate.provider === 'string'
    && typeof candidate.projectDisplayName === 'string'
    && typeof candidate.sessionSummary === 'string'
    && typeof candidate.bookmarkedAt === 'string'
  );
}

export function refreshBookmarkMetadata(bookmarks: BookmarkedSession[], projects: Project[]): BookmarkedSession[] {
  const sessionsByKey = new Map<string, BookmarkedSession>();

  for (const project of projects) {
    for (const session of project.sessions ?? []) {
      const provider = session.__provider ?? session.provider;
      if (!provider) {
        continue;
      }

      const identity = {
        projectId: project.projectId,
        sessionId: session.id,
        provider,
      };
      sessionsByKey.set(getBookmarkKey(identity), {
        ...identity,
        projectDisplayName: project.displayName,
        sessionSummary: session.summary ?? session.title ?? session.name ?? 'Untitled Session',
        bookmarkedAt: '',
      });
    }
  }

  return bookmarks.map((bookmark) => {
    const latest = sessionsByKey.get(getBookmarkKey(bookmark));
    if (!latest) {
      return bookmark;
    }

    return {
      ...bookmark,
      projectDisplayName: latest.projectDisplayName,
      sessionSummary: latest.sessionSummary,
    };
  });
}

export function useBookmarks() {
  const [bookmarks, setBookmarks] = useState<BookmarkedSession[]>(readBookmarks);

  useEffect(() => {
    const handleChange = () => setBookmarks(readBookmarks());
    window.addEventListener('storage', handleChange);
    window.addEventListener('cloudcli:bookmarks-changed', handleChange);
    return () => {
      window.removeEventListener('storage', handleChange);
      window.removeEventListener('cloudcli:bookmarks-changed', handleChange);
    };
  }, []);

  const save = useCallback((nextBookmarks: BookmarkedSession[]) => {
    setBookmarks(nextBookmarks);
    writeBookmarks(nextBookmarks);
  }, []);

  const isBookmarked = useCallback(
    (session: BookmarkIdentity) => bookmarks.some((bookmark) => getBookmarkKey(bookmark) === getBookmarkKey(session)),
    [bookmarks],
  );

  const toggleBookmark = useCallback((session: BookmarkedSession) => {
    const key = getBookmarkKey(session);
    const exists = bookmarks.some((bookmark) => getBookmarkKey(bookmark) === key);
    save(exists ? bookmarks.filter((bookmark) => getBookmarkKey(bookmark) !== key) : [session, ...bookmarks]);
  }, [bookmarks, save]);

  const removeBookmark = useCallback((session: BookmarkIdentity) => {
    const key = getBookmarkKey(session);
    save(bookmarks.filter((bookmark) => getBookmarkKey(bookmark) !== key));
  }, [bookmarks, save]);

  const refreshFromProjects = useCallback((projects: Project[]) => {
    const refreshed = refreshBookmarkMetadata(bookmarks, projects);
    if (JSON.stringify(refreshed) !== JSON.stringify(bookmarks)) {
      save(refreshed);
    }
  }, [bookmarks, save]);

  return {
    bookmarks,
    isBookmarked,
    toggleBookmark,
    removeBookmark,
    refreshFromProjects,
  };
}
