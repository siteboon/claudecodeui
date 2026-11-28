import assert from 'node:assert/strict';

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import type { Project, ProjectSession } from '@/shared/types';

/**
 * The sidebar's delete callbacks are also handed to plugin UIs, which may hold one across an await or after their
 * own host unmounted. A callback created while A was selected must still compare against the selection at call time.
 */

const projectsResponse = vi.fn();
vi.mock('@/shared/api', () => ({
  api: {
    projects: () => projectsResponse(),
    projectTaskmaster: () => Promise.resolve({ ok: false }),
    sessionDetails: () => Promise.resolve({ ok: false }),
    projectSessions: () => Promise.resolve({ ok: false }),
  },
}));

const session = (id: string): ProjectSession => ({ id, summary: id } as ProjectSession);
const project = (id: string, sessions: ProjectSession[]): Project => ({
  projectId: id, path: `/${id}`, fullPath: `/${id}`, displayName: id, isStarred: false,
  sessions, sessionMeta: { hasMore: false, total: sessions.length },
});

const renderProjectsState = async (navigate: ReturnType<typeof vi.fn>) => {
  const { useProjectsState } = await import('@/modules/project-workspace/hooks/useProjectsState');
  return renderHook(() => useProjectsState({
    sessionId: undefined as never,
    navigate: navigate as never,
    subscribe: () => () => undefined,
    isMobile: false,
    isSessionProcessing: () => false,
  }));
};

beforeEach(() => { localStorage.clear(); projectsResponse.mockReset(); });
afterEach(() => { vi.resetModules(); });

test('a session-delete callback captured before a selection change does not clear the new selection', async () => {
  projectsResponse.mockResolvedValue({ ok: true, json: async () => [project('p', [session('a'), session('b')])] });
  const navigate = vi.fn();
  const { result } = await renderProjectsState(navigate);
  await waitFor(() => assert.equal(result.current.projects.length, 1));

  act(() => { result.current.handleSessionSelect(session('a')); });
  const staleDelete = result.current.sidebarSharedProps.onSessionDelete; // captured while A is selected
  act(() => { result.current.handleSessionSelect(session('b')); });
  navigate.mockClear();

  act(() => { staleDelete('a'); });
  assert.equal(result.current.selectedSession?.id, 'b', 'deleting A keeps B selected');
  assert.deepEqual(navigate.mock.calls, []);

  act(() => { staleDelete('b'); });
  assert.equal(result.current.selectedSession, null, 'deleting the current selection still leaves it');
});

test('a project-delete callback captured before a selection change does not clear the new selection', async () => {
  projectsResponse.mockResolvedValue({ ok: true, json: async () => [project('p1', []), project('p2', [])] });
  const navigate = vi.fn();
  const { result } = await renderProjectsState(navigate);
  await waitFor(() => assert.equal(result.current.projects.length, 2));

  act(() => { result.current.handleProjectSelect(result.current.projects[0]); });
  const staleDelete = result.current.sidebarSharedProps.onProjectDelete; // captured while p1 is selected
  act(() => { result.current.handleProjectSelect(result.current.projects[1]); });
  navigate.mockClear();

  act(() => { staleDelete('p1'); });
  assert.equal(result.current.selectedProject?.projectId, 'p2', 'deleting p1 keeps p2 selected');
  assert.deepEqual(navigate.mock.calls, []);
  assert.deepEqual(result.current.projects.map((p) => p.projectId), ['p2']);
});
