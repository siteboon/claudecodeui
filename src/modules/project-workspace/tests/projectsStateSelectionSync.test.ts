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

const renderProjectsState = async () => {
  const { useProjectsState } = await import(
    '@/modules/project-workspace/hooks/useProjectsState'
  );

  return renderHook(() =>
    useProjectsState({
      sessionId: undefined,
      navigate: vi.fn(),
      subscribe: () => () => undefined,
      isMobile: false,
      isSessionProcessing: () => false,
    }),
  );
};

beforeEach(() => {
  localStorage.clear();
  projectsResponse.mockReset();
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
