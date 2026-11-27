import assert from 'node:assert/strict';

import { act, renderHook, waitFor } from '@testing-library/react';
import type { TFunction } from 'i18next';
import { beforeEach, test, vi } from 'vitest';

import type { Project, RecentConversationListItem, ServerEvent } from '@/shared/types';

const recentConversationsResponse = vi.fn();
const sessionEventListeners = new Set<(event: ServerEvent) => void>();

const subscribeToSessionEvents = (listener: (event: ServerEvent) => void) => {
  sessionEventListeners.add(listener);
  return () => { sessionEventListeners.delete(listener); };
};

const sendSessionEvent = (event: ServerEvent) => {
  act(() => sessionEventListeners.forEach((listener) => listener(event)));
};

function recentResponse(rows: RecentConversationListItem[], limit = rows.length, offset = 0) {
  return {
    ok: true,
    json: async () => ({
      data: {
        conversations: rows.slice(offset, offset + limit),
        total: rows.length,
        hasMore: offset + limit < rows.length,
      },
    }),
  };
}

vi.mock('@/shared/api', () => ({
  api: {
    recentConversations: (page: { limit: number; offset: number }) => recentConversationsResponse(page),
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
    subscribeToSessionEvents,
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

test('an external turn brings a previously unloaded conversation to the top while the tab stays open', async () => {
  const rows = Array.from({ length: 45 }, (_, index) => conversation(`session-${index}`, `Title ${index}`));
  let orderedRows = rows;
  recentConversationsResponse.mockImplementation(async ({ limit, offset }) => recentResponse(orderedRows, limit, offset));

  const { result } = renderController([]);
  act(() => result.current.setSearchMode('conversations'));
  await waitFor(() => assert.equal(result.current.recentConversations.length, 40));

  // The native activity arrives through the watcher. The global feed has the
  // newer timestamp even when the owning project was never loaded in the UI.
  const resumed = {
    ...rows[44],
    provider: 'codex' as const,
    projectId: null,
    lastActivity: '2026-09-22T10:00:00.000Z',
  };
  orderedRows = [resumed, ...rows.slice(0, 44)];
  sendSessionEvent({ kind: 'session_upserted', sessionId: resumed.sessionId, project: null });
  sendSessionEvent({ kind: 'session_upserted', sessionId: resumed.sessionId, project: null });

  await waitFor(() => assert.deepEqual(result.current.recentConversations[0], resumed));
  assert.equal(recentConversationsResponse.mock.calls.length, 2, 'a burst of updates uses one request');
  assert.equal(result.current.recentConversationsTotal, 45);
  assert.equal(result.current.recentConversationsHasMore, true);
});

test('live reordering preserves loaded pages and keeps the next scroll page in sequence', async () => {
  const rows = Array.from({ length: 137 }, (_, index) => conversation(`session-${index}`, `Title ${index}`));
  let orderedRows = rows;
  recentConversationsResponse.mockImplementation(async ({ limit, offset }) => recentResponse(orderedRows, limit, offset));
  const { result } = renderController([]);
  act(() => result.current.setSearchMode('conversations'));
  await waitFor(() => assert.equal(result.current.recentConversations.length, 40));
  act(() => result.current.loadMoreRecentConversations());
  await waitFor(() => assert.equal(result.current.recentConversations.length, 80));
  act(() => result.current.loadMoreRecentConversations());
  await waitFor(() => assert.equal(result.current.recentConversations.length, 120));

  const resumed = { ...rows[105], lastActivity: '2026-09-22T10:00:00.000Z' };
  orderedRows = [resumed, ...rows.slice(0, 105), ...rows.slice(106)];
  sendSessionEvent({ kind: 'session_upserted', sessionId: resumed.sessionId });
  await waitFor(() => assert.deepEqual(result.current.recentConversations, orderedRows.slice(0, 120)));
  assert.deepEqual(recentConversationsResponse.mock.calls.slice(3), [[{ limit: 100, offset: 0 }], [{ limit: 20, offset: 100 }]]);

  act(() => result.current.loadMoreRecentConversations());
  await waitFor(() => assert.deepEqual(result.current.recentConversations, orderedRows));
  assert.equal(result.current.recentConversationsHasMore, false);
});

test('events received during a live read trigger a follow-up, and leaving the tab cancels the subscription', async () => {
  const { result } = await openConversationsTab([]);
  const initialRows = result.current.recentConversations;
  let releaseRead!: (response: ReturnType<typeof recentResponse>) => void;
  recentConversationsResponse.mockImplementationOnce(
    () => new Promise<ReturnType<typeof recentResponse>>((resolve) => { releaseRead = resolve; }),
  );

  sendSessionEvent({ kind: 'websocket_reconnected' });
  await waitFor(() => assert.equal(recentConversationsResponse.mock.calls.length, 2));
  assert.equal(result.current.recentConversations, initialRows, 'existing rows stay visible during a live read');

  const updated = { ...initialRows[1], lastActivity: '2026-09-22T10:00:00.000Z' };
  const updatedRows = [updated, initialRows[0]];
  recentConversationsResponse.mockResolvedValue(recentResponse(updatedRows));
  sendSessionEvent({ kind: 'session_upserted', sessionId: updated.sessionId });
  await act(async () => releaseRead(recentResponse(initialRows)));

  await waitFor(() => assert.deepEqual(result.current.recentConversations, updatedRows));
  assert.equal(recentConversationsResponse.mock.calls.length, 3);

  sendSessionEvent({ kind: 'session_upserted', sessionId: updated.sessionId });
  act(() => result.current.setSearchMode('projects'));
  assert.equal(sessionEventListeners.size, 0);
  sendSessionEvent({ kind: 'session_upserted', sessionId: updated.sessionId });
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(recentConversationsResponse.mock.calls.length, 3);
});
