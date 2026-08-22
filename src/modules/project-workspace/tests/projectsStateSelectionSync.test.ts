import assert from 'node:assert/strict';

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import type { Project } from '@/shared/types';

/**
 * Regression guard for the denormalized selection copy.
 *
 * `selectedProject` is a copy of one row of `projects`. `fetchProjects` used to
 * write only `projects`, so renaming the selected project — which reaches this
 * path through paletteOps.refreshProjects — left the workspace header and the
 * document title showing the old name until an unrelated websocket frame
 * happened to fire.
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

const buildProject = (overrides: Partial<Project> = {}): Project => ({
  projectId: 'project-1',
  path: '/repo',
  fullPath: '/repo',
  displayName: 'Original name',
  isStarred: false,
  sessions: [],
  sessionMeta: { hasMore: false, total: 0 },
  ...overrides,
});

const respondWith = (projects: Project[]) => {
  projectsResponse.mockResolvedValue({
    ok: true,
    json: async () => projects,
  });
};

type ServerEventListener = (event: { kind: string }) => void;

const listeners = new Set<ServerEventListener>();

const emit = (event: { kind: string }) => {
  for (const listener of listeners) {
    listener(event);
  }
};

const renderProjectsState = async () => {
  const { useProjectsState } = await import(
    '@/modules/project-workspace/hooks/useProjectsState'
  );

  return renderHook(() =>
    useProjectsState({
      sessionId: undefined,
      navigate: vi.fn(),
      subscribe: (listener: ServerEventListener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      isMobile: false,
      isSessionProcessing: () => false,
    }),
  );
};

beforeEach(() => {
  localStorage.clear();
  projectsResponse.mockReset();
  listeners.clear();
});

afterEach(() => {
  vi.resetModules();
});

test('a refresh that renames the selected project updates the selected copy', async () => {
  respondWith([buildProject()]);
  const { result } = await renderProjectsState();

  // A single project auto-selects, which is how the workspace header gets its value.
  await waitFor(() => {
    assert.equal(result.current.selectedProject?.displayName, 'Original name');
  });

  respondWith([buildProject({ displayName: 'Renamed' })]);
  await act(async () => {
    await result.current.refreshProjectsSilently();
  });

  assert.equal(result.current.selectedProject?.displayName, 'Renamed');
  assert.equal(result.current.projects[0].displayName, 'Renamed');
});

test('a refresh that changes nothing workspace-visible keeps the selected object identity', async () => {
  respondWith([buildProject()]);
  const { result } = await renderProjectsState();

  await waitFor(() => {
    assert.ok(result.current.selectedProject);
  });
  const selectedBefore = result.current.selectedProject;

  // Same metadata, new session rows — the sidebar changes, the workspace must not.
  respondWith([
    buildProject({
      sessions: [{ id: 'session-1', summary: 'a session' }],
      sessionMeta: { hasMore: false, total: 1 },
    }),
  ]);
  await act(async () => {
    await result.current.refreshProjectsSilently();
  });

  assert.equal(
    result.current.selectedProject,
    selectedBefore,
    'selectedProject must keep its identity so the main region does not re-render',
  );
});

test('a refresh that no longer lists the selected project leaves the selection alone', async () => {
  respondWith([buildProject()]);
  const { result } = await renderProjectsState();

  await waitFor(() => {
    assert.ok(result.current.selectedProject);
  });
  const selectedBefore = result.current.selectedProject;

  respondWith([buildProject({ projectId: 'project-2', displayName: 'Other' })]);
  await act(async () => {
    await result.current.refreshProjectsSilently();
  });

  assert.equal(result.current.selectedProject, selectedBefore);
});

test('a superseded refresh does not revert the selection', async () => {
  respondWith([buildProject()]);
  const { result } = await renderProjectsState();
  await waitFor(() => {
    assert.equal(result.current.selectedProject?.displayName, 'Original name');
  });

  // An older in-flight request resolves after a newer one. Applying it would put
  // the pre-rename name back in the workspace header.
  let releaseStaleResponse: (() => void) | null = null;
  const staleResponse = new Promise<void>((resolve) => {
    releaseStaleResponse = resolve;
  });
  projectsResponse.mockImplementationOnce(async () => {
    await staleResponse;
    return { ok: true, json: async () => [buildProject({ displayName: 'Stale name' })] };
  });

  const stale = result.current.refreshProjectsSilently();

  respondWith([buildProject({ displayName: 'Renamed' })]);
  await act(async () => {
    await result.current.refreshProjectsSilently();
  });
  assert.equal(result.current.selectedProject?.displayName, 'Renamed');

  await act(async () => {
    releaseStaleResponse?.();
    await stale;
  });

  assert.equal(
    result.current.selectedProject?.displayName,
    'Renamed',
    'a superseded response must not overwrite a newer one',
  );
});

test('a websocket reconnect re-syncs the project list', async () => {
  respondWith([buildProject()]);
  const { result } = await renderProjectsState();
  await waitFor(() => {
    assert.equal(result.current.projects.length, 1);
  });

  // A session created while the socket was down is only in the server's copy:
  // the list is maintained by incremental deltas, so nothing else recovers it.
  respondWith([
    buildProject(),
    buildProject({ projectId: 'project-2', displayName: 'Created while offline' }),
  ]);

  await act(async () => {
    emit({ kind: 'websocket_reconnected' });
    await Promise.resolve();
  });

  await waitFor(() => {
    assert.equal(result.current.projects.length, 2);
  });
  assert.equal(result.current.projects[1].displayName, 'Created while offline');
});

test('a superseded first load never renders the sidebar as empty', async () => {
  // The mount fetch is held open so a refresh can supersede it, which is what
  // the websocket's reconnect re-sync does on a real page load.
  let releaseFirstLoad: (() => void) | null = null;
  const firstLoadInFlight = new Promise<void>((resolve) => {
    releaseFirstLoad = resolve;
  });
  projectsResponse.mockImplementationOnce(async () => {
    await firstLoadInFlight;
    return { ok: true, json: async () => [buildProject()] };
  });

  const { useProjectsState } = await import(
    '@/modules/project-workspace/hooks/useProjectsState'
  );

  // Every render the sidebar would have seen. The bug is not a final state but a
  // frame: `isLoadingProjects` went false while `projects` was still empty, so
  // SidebarProjectsState rendered "No projects found" for as long as the newest
  // response took to land.
  const renderedStates: Array<{ isLoading: boolean; projectCount: number }> = [];
  const { result } = renderHook(() => {
    const state = useProjectsState({
      sessionId: undefined,
      navigate: vi.fn(),
      subscribe: (listener: ServerEventListener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      isMobile: false,
      isSessionProcessing: () => false,
    });
    renderedStates.push({
      isLoading: state.isLoadingProjects,
      projectCount: state.projects.length,
    });
    return state;
  });

  let releaseRefresh: (() => void) | null = null;
  const refreshInFlight = new Promise<void>((resolve) => {
    releaseRefresh = resolve;
  });
  projectsResponse.mockImplementationOnce(async () => {
    await refreshInFlight;
    return { ok: true, json: async () => [buildProject()] };
  });

  let refresh: Promise<void> | null = null;
  act(() => {
    refresh = result.current.refreshProjectsSilently();
  });

  // The superseded mount response resolves first and returns without writing
  // `projects`, then the newest one lands.
  await act(async () => {
    releaseFirstLoad?.();
    await firstLoadInFlight;
    await Promise.resolve();
    await Promise.resolve();
  });
  await act(async () => {
    releaseRefresh?.();
    await refresh;
  });

  await waitFor(() => {
    assert.equal(result.current.projects.length, 1);
  });
  assert.equal(result.current.isLoadingProjects, false);
  assert.ok(
    !renderedStates.some((state) => !state.isLoading && state.projectCount === 0),
    `the sidebar must never see a settled empty list while the load is still in flight: ${JSON.stringify(renderedStates)}`,
  );
});
