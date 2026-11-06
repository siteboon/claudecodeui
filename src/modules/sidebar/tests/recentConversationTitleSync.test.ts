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
    deleteSession: () => Promise.resolve({ ok: true, text: async () => '' }),
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

// `projects` is not told when a session is archived or deleted elsewhere, so
// a session missing from it may still exist (e.g. on a later page).
test('a row whose session is missing from the project list is kept', async () => {
  const { result, rerender } = await openWithRows([buildLiveProject(asLoaded)]);

  rerender({ projects: [buildLiveProject({ 'session-1': asLoaded['session-1'] })] });
  assert.deepEqual(result.current.recentConversations.map((row) => row.sessionId), ['session-1', 'session-2']);
});

test('an empty list picks up a session that starts after it was fetched', async () => {
  recentConversationsResponse.mockResolvedValue({
    ok: true,
    json: async () => ({ data: { conversations: [], total: 0, hasMore: false } }),
  });
  const rendered = renderController([buildLiveProject({})]);
  act(() => {
    rendered.result.current.setSearchMode('conversations');
  });
  await waitFor(() => {
    assert.equal(recentConversationsResponse.mock.calls.length, 1);
  });
  await act(async () => {
    await Promise.resolve();
  });

  const startedAt = new Date(Date.now() + 60_000).toISOString();
  rendered.rerender({ projects: [buildLiveProject({ 'session-new': { summary: 'New', lastActivity: startedAt } })] });

  assert.deepEqual(rendered.result.current.recentConversations.map((row) => row.sessionId), ['session-new']);
  assert.equal(rendered.result.current.recentConversationsTotal, 1);
});

test('an added session keeps its provider and counts towards the total', async () => {
  const { result, rerender } = await openWithRows([buildLiveProject(asLoaded)]);
  const project = buildLiveProject(asLoaded);
  project.sessions = [
    ...(project.sessions ?? []),
    { id: 'session-codex', summary: 'Codex run', lastActivity: '2026-09-22T11:00:00.000Z', provider: 'codex' },
  ];

  rerender({ projects: [project] });

  assert.equal(result.current.recentConversations[0].sessionId, 'session-codex');
  assert.equal(result.current.recentConversations[0].provider, 'codex');
  assert.equal(result.current.recentConversationsTotal, 3);
});

test('rows keep their identity when the live sessions match them', async () => {
  const { result, rerender } = await openWithRows([buildLiveProject(asLoaded)]);
  const rowsBefore = result.current.recentConversations;

  rerender({ projects: [buildLiveProject(asLoaded)] });

  assert.equal(result.current.recentConversations, rowsBefore);
});

test('rows without a readable time do not make every live session look new', async () => {
  recentConversationsResponse.mockResolvedValue({
    ok: true,
    json: async () => ({
      data: {
        conversations: [
          { ...conversation('session-1', 'First'), lastActivity: null },
          { ...conversation('session-2', 'Second'), lastActivity: 'not a time' },
        ],
        total: 2,
        hasMore: false,
      },
    }),
  });
  const { result, rerender } = await openConversationsTab([buildLiveProject(asLoaded)]);
  // No loaded row has a readable time, so only activity after the fetch is new.
  rerender({ projects: [buildLiveProject({ ...asLoaded, 'session-old': { summary: 'Old', lastActivity: '2020-01-01T00:00:00.000Z' } })] });

  assert.ok(!result.current.recentConversations.some((row) => row.sessionId === 'session-old'));
  assert.equal(result.current.recentConversationsTotal, 2);
});

test('a session deleted here is not brought back by a stale project refresh', async () => {
  const newest = { ...asLoaded, 'session-3': { summary: 'Third', lastActivity: '2026-09-22T11:00:00.000Z' } };
  const { result, rerender } = await openWithRows([buildLiveProject(asLoaded)]);
  rerender({ projects: [buildLiveProject(newest)] });
  assert.equal(result.current.recentConversations[0].sessionId, 'session-3');

  act(() => {
    result.current.showDeleteSessionConfirmation('session-3', 'Third');
  });
  await act(async () => {
    await result.current.confirmDeleteSession(false);
  });
  assert.ok(!result.current.recentConversations.some((row) => row.sessionId === 'session-3'));

  // A refresh that started before the delete still lists the session.
  rerender({ projects: [buildLiveProject(newest)] });
  assert.ok(!result.current.recentConversations.some((row) => row.sessionId === 'session-3'));
});
