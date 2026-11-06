import assert from 'node:assert/strict';

import { act, renderHook, waitFor } from '@testing-library/react';
import type { TFunction } from 'i18next';
import { beforeEach, test, vi } from 'vitest';

import type { Project, RecentConversationListItem } from '@/shared/types';

/**
 * The Conversations list keeps its own copy of each session's title and is
 * fetched only when its tab opens. A session renamed from the workspace header
 * is patched straight into `projects`, so the list has to fold that title in
 * itself, or the highlighted row would keep the old name beside the new header.
 */

const recentConversationsResponse = vi.fn();

vi.mock('@/shared/api', () => ({
  api: {
    recentConversations: () => recentConversationsResponse(),
    archivedProjects: () => Promise.resolve({ ok: true, json: async () => ({ data: { projects: [] } }) }),
    getArchivedSessions: () => Promise.resolve({ ok: true, json: async () => ({ data: { sessions: [] } }) }),
  },
}));

const { useSidebarController } = await import('@/modules/sidebar/hooks/useSidebarController');

const t = ((key: string) => key) as unknown as TFunction;

const conversation = (sessionId: string, sessionTitle: string): RecentConversationListItem => ({
  sessionId,
  provider: 'claude',
  projectId: 'project-1',
  projectDisplayName: 'repo',
  sessionTitle,
  lastActivity: '2026-09-22T09:30:00.000Z',
});

const buildProject = (summaries: Record<string, string>): Project => ({
  projectId: 'project-1',
  path: '/repo',
  fullPath: '/repo',
  displayName: 'repo',
  isStarred: false,
  sessions: Object.entries(summaries).map(([id, summary]) => ({ id, summary, __provider: 'claude' as const })),
  sessionMeta: { hasMore: false, total: Object.keys(summaries).length },
});

const renderController = (initialProjects: Project[]) => renderHook(
  ({ projects }: { projects: Project[] }) => useSidebarController({
    projects,
    selectedProject: null,
    selectedSession: null,
    activeSessions: new Set<string>(),
    backgroundSessionIds: new Set<string>(),
    isLoading: false,
    isMobile: false,
    t,
    onRefresh: vi.fn(),
    onProjectSelect: vi.fn(),
    onSessionSelect: vi.fn(),
    setCurrentProject: vi.fn(),
    setSidebarVisible: vi.fn(),
    sidebarVisible: true,
  }),
  { initialProps: { projects: initialProjects } },
);

const openConversationsTab = async (initialProjects: Project[]) => {
  const rendered = renderController(initialProjects);
  act(() => {
    rendered.result.current.setSearchMode('conversations');
  });
  await waitFor(() => {
    assert.equal(rendered.result.current.recentConversations.length, 2);
  });
  return rendered;
};

beforeEach(() => {
  localStorage.clear();
  recentConversationsResponse.mockReset();
  recentConversationsResponse.mockResolvedValue({
    ok: true,
    json: async () => ({
      data: {
        conversations: [conversation('session-1', 'Original title'), conversation('session-2', 'session-2')],
        total: 2,
        hasMore: false,
      },
    }),
  });
});

test('a title renamed in `projects` lands on the matching conversation row', async () => {
  const { result, rerender } = await openConversationsTab([buildProject({ 'session-1': 'Original title', 'session-2': '' })]);

  rerender({ projects: [buildProject({ 'session-1': 'Renamed from header', 'session-2': '' })] });

  assert.deepEqual(
    result.current.recentConversations.map((row) => row.sessionTitle),
    ['Renamed from header', 'session-2'],
  );
  // No refetch was needed for the row to catch up.
  assert.equal(recentConversationsResponse.mock.calls.length, 1);
});

test('rows keep their identity, and an unnamed session keeps its id, when nothing was renamed', async () => {
  const { result, rerender } = await openConversationsTab([buildProject({ 'session-1': 'Original title', 'session-2': '' })]);
  const rowsBefore = result.current.recentConversations;

  rerender({ projects: [buildProject({ 'session-1': 'Original title', 'session-2': '' })] });

  assert.equal(result.current.recentConversations, rowsBefore);
});

// Beyond titles, the rows follow the live sessions: activity time and order,
// sessions that started after the fetch, and sessions that went away.

type LiveSession = { summary?: string; lastActivity?: string };

const buildLiveProject = (sessions: Record<string, LiveSession>, hasMore = false): Project => ({
  projectId: 'project-1',
  path: '/repo',
  fullPath: '/repo',
  displayName: 'repo',
  isStarred: false,
  sessions: Object.entries(sessions).map(([id, session]) => ({ id, ...session, __provider: 'claude' as const })),
  sessionMeta: { hasMore, total: Object.keys(sessions).length },
});

const loadedRows = [
  { ...conversation('session-1', 'First'), lastActivity: '2026-09-22T09:30:00.000Z' },
  { ...conversation('session-2', 'Second'), lastActivity: '2026-09-22T09:00:00.000Z' },
];

const openWithRows = async (initialProjects: Project[]) => {
  recentConversationsResponse.mockResolvedValue({
    ok: true,
    json: async () => ({ data: { conversations: loadedRows, total: 2, hasMore: false } }),
  });
  return openConversationsTab(initialProjects);
};

const asLoaded = {
  'session-1': { summary: 'First', lastActivity: '2026-09-22T09:30:00.000Z' },
  'session-2': { summary: 'Second', lastActivity: '2026-09-22T09:00:00.000Z' },
};

test('a conversation with a new message moves to the top with its new time', async () => {
  const { result, rerender } = await openWithRows([buildLiveProject(asLoaded)]);

  rerender({
    projects: [buildLiveProject({ ...asLoaded, 'session-2': { summary: 'Second', lastActivity: '2026-09-22T10:00:00.000Z' } })],
  });

  assert.deepEqual(
    result.current.recentConversations.map((row) => [row.sessionId, row.lastActivity]),
    [['session-2', '2026-09-22T10:00:00.000Z'], ['session-1', '2026-09-22T09:30:00.000Z']],
  );
  assert.equal(recentConversationsResponse.mock.calls.length, 1);
});

test('a session that started after the list was fetched is added at the top', async () => {
  const { result, rerender } = await openWithRows([buildLiveProject(asLoaded)]);

  rerender({
    projects: [buildLiveProject({ ...asLoaded, 'session-3': { summary: '', lastActivity: '2026-09-22T11:00:00.000Z' } })],
  });

  assert.deepEqual(result.current.recentConversations.map((row) => row.sessionId), ['session-3', 'session-1', 'session-2']);
  // Like the server, an untitled session shows its id.
  assert.equal(result.current.recentConversations[0].sessionTitle, 'session-3');
  assert.equal(result.current.recentConversations[0].projectId, 'project-1');
});

test('a session that went away is dropped only where the project list covers it', async () => {
  const { result, rerender } = await openWithRows([buildLiveProject(asLoaded)]);

  // Every session of the project is loaded and session-2 is gone: archived or deleted.
  rerender({ projects: [buildLiveProject({ 'session-1': asLoaded['session-1'] })] });
  assert.deepEqual(result.current.recentConversations.map((row) => row.sessionId), ['session-1']);
});

test('a row older than the sessions a project has loaded so far is kept', async () => {
  const { result, rerender } = await openWithRows([buildLiveProject(asLoaded)]);

  // Only the newest session is loaded and more exist: session-2 may simply be
  // on a later page of the project list.
  rerender({ projects: [buildLiveProject({ 'session-1': asLoaded['session-1'] }, true)] });
  assert.deepEqual(result.current.recentConversations.map((row) => row.sessionId), ['session-1', 'session-2']);
});

test('rows keep their identity when the live sessions match them', async () => {
  const { result, rerender } = await openWithRows([buildLiveProject(asLoaded)]);
  const rowsBefore = result.current.recentConversations;

  rerender({ projects: [buildLiveProject(asLoaded)] });

  assert.equal(result.current.recentConversations, rowsBefore);
});
