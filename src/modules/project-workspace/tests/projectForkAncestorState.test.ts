import assert from 'node:assert/strict';

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, test, vi } from 'vitest';

import { useProjectsState } from '@/modules/project-workspace/hooks/useProjectsState';
import type { Project, ProjectSession } from '@/shared/types';

const mocks = vi.hoisted(() => ({ projects: vi.fn(), projectSessions: vi.fn(), rename: vi.fn() }));
vi.mock('@/shared/api', () => ({ api: {
  projects: mocks.projects, projectSessions: mocks.projectSessions, renameSession: mocks.rename,
  projectTaskmaster: () => Promise.resolve({ ok: false }), sessionDetails: () => Promise.resolve({ ok: false }),
} }));

const root: ProjectSession = { id: 'root', summary: 'Original', provider: 'claude', forkedFromSessionId: null };
const middle: ProjectSession = { id: 'middle', summary: 'Middle', provider: 'claude', forkedFromSessionId: 'root' };
const leaf: ProjectSession = { id: 'leaf', summary: 'Leaf', provider: 'claude', forkedFromSessionId: 'middle', forkAncestors: [middle, root] };
const project: Project = { projectId: 'project', displayName: 'Project', path: '/repo', fullPath: '/repo', sessions: [leaf], sessionMeta: { total: 3, hasMore: true } };
const listeners = new Set<(event: never) => void>();
const subscribe = (listener: (event: never) => void) => { listeners.add(listener); return () => listeners.delete(listener); };
const emit = (event: unknown) => listeners.forEach((listener) => listener(event as never));

const start = async () => {
  const hook = renderHook(() => useProjectsState({
    sessionId: undefined, navigate: vi.fn(), subscribe, isMobile: false, isSessionProcessing: () => false,
  }));
  await waitFor(() => assert.equal(hook.result.current.projects.length, 1));
  return hook.result;
};

beforeEach(() => {
  localStorage.clear(); listeners.clear(); vi.clearAllMocks();
  mocks.projects.mockResolvedValue({ ok: true, json: async () => [project] });
  mocks.rename.mockResolvedValue({ ok: true });
});

test('renaming an off-page ancestor updates its visible context without a refetch', async () => {
  const result = await start();
  await act(async () => { assert.equal(await result.current.renameSession('root', 'Renamed source'), true); });
  assert.equal(result.current.projects[0].sessions?.[0].forkAncestors?.find((ancestor) => ancestor.id === 'root')?.summary, 'Renamed source');
  assert.equal(result.current.projects[0].sessions?.length, 1);
  assert.equal(mocks.projects.mock.calls.length, 1);
});

test('removing an ancestor never resurrects it from another fork snapshot or removes independent forks', async () => {
  const result = await start();
  act(() => result.current.handleSessionDelete('middle'));
  assert.deepEqual(result.current.projects[0].sessions?.map((session) => session.id), ['leaf']);
  assert.deepEqual(result.current.projects[0].sessionMeta, { total: 2, hasMore: true });
  assert.equal(result.current.projects[0].sessions?.[0].forkAncestors?.some((ancestor) => ancestor.id === 'middle'), false);
});

test('an upsert for a known ancestor adds its current row without counting it as a new session', async () => {
  const result = await start();
  act(() => emit({
    kind: 'session_upserted', sessionId: 'root', providerSessionId: 'native-root', provider: 'claude',
    session: { ...root, summary: 'Fresh source' },
    project: { projectId: 'project', path: '/repo', fullPath: '/repo', displayName: 'Project', isStarred: false },
  }));
  assert.equal(result.current.projects[0].sessionMeta?.total, 3);
  assert.equal(result.current.projects[0].sessions?.find((session) => session.id === 'root')?.summary, 'Fresh source');
  assert.deepEqual(result.current.projects[0].sessions?.map((session) => session.id), ['root', 'leaf']);
});

test('loading subsequent pages excludes ancestor context from the offset and deduplicates the tree', async () => {
  const result = await start();
  mocks.projectSessions.mockResolvedValueOnce({ ok: true, json: async () => ({
    sessions: [{ ...middle, forkAncestors: [root] }], sessionMeta: { total: 3, hasMore: true },
  }) });
  await act(async () => { await result.current.loadMoreProjectSessions('project'); });
  assert.deepEqual(mocks.projectSessions.mock.calls[0], ['project', { limit: 20, offset: 1 }]);
  assert.deepEqual(result.current.projects[0].sessions?.map((session) => session.id).sort(), ['leaf', 'middle']);
  mocks.projectSessions.mockResolvedValueOnce({ ok: true, json: async () => ({
    sessions: [root], sessionMeta: { total: 3, hasMore: false },
  }) });
  await act(async () => { await result.current.loadMoreProjectSessions('project'); });
  assert.deepEqual(mocks.projectSessions.mock.calls[1], ['project', { limit: 20, offset: 2 }]);
  assert.equal(result.current.projects[0].sessions?.length, 3);
  assert.equal(result.current.projects[0].sessionMeta?.hasMore, false);
});
