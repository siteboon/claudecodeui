import assert from 'node:assert/strict';
import test from 'node:test';

import { getBookmarkKey, refreshBookmarkMetadata, type BookmarkedSession } from './useBookmarkStore';
import type { Project } from '../types/app';

test('bookmark keys include project, provider, and session ids', () => {
  assert.notEqual(
    getBookmarkKey({ projectId: 'project-1', provider: 'claude', sessionId: 'session-1' }),
    getBookmarkKey({ projectId: 'project-1', provider: 'codex', sessionId: 'session-1' }),
  );
});

test('bookmark metadata refreshes from loaded project sessions without dropping unseen bookmarks', () => {
  const bookmarks: BookmarkedSession[] = [
    {
      projectId: 'project-1',
      provider: 'claude',
      sessionId: 'session-1',
      projectDisplayName: 'Old Project',
      sessionSummary: 'Old Summary',
      bookmarkedAt: '2026-01-01T00:00:00.000Z',
    },
    {
      projectId: 'project-2',
      provider: 'codex',
      sessionId: 'session-2',
      projectDisplayName: 'Unloaded Project',
      sessionSummary: 'Unloaded Summary',
      bookmarkedAt: '2026-01-01T00:00:00.000Z',
    },
  ];
  const projects: Project[] = [
    {
      projectId: 'project-1',
      displayName: 'New Project',
      fullPath: '/workspace/project-1',
      sessions: [{ id: 'session-1', __provider: 'claude', summary: 'New Summary' }],
    },
  ];

  assert.deepEqual(refreshBookmarkMetadata(bookmarks, projects), [
    {
      ...bookmarks[0],
      projectDisplayName: 'New Project',
      sessionSummary: 'New Summary',
    },
    bookmarks[1],
  ]);
});
