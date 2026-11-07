import assert from 'node:assert/strict';

import { StrictMode } from 'react';
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import type { Project } from '@/shared/types';

/**
 * Regression guard for the sidebar's loading screen appearing twice per refresh.
 *
 * The mount effect used to depend only on `fetchProjects`, so StrictMode's
 * double-invoked effects issued two `/api/projects` requests. Each one makes the
 * server re-scan every provider transcript and re-broadcast `loading_progress`
 * from zero, so the sidebar replayed its whole progress bar a second time.
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

const buildProject = (): Project => ({
  projectId: 'project-1',
  path: '/repo',
  fullPath: '/repo',
  displayName: 'Repo',
  isStarred: false,
  sessions: [],
  sessionMeta: { hasMore: false, total: 0 },
});

type ServerEventListener = (event: { kind: string }) => void;

const listeners = new Set<ServerEventListener>();

const renderProjectsState = async (wrapper?: (props: { children: ReactNode }) => ReactNode) => {
  const { useProjectsState } = await import(
    '@/modules/project-workspace/hooks/useProjectsState'
  );

  return renderHook(
    () =>
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
    wrapper ? { wrapper } : undefined,
  );
};

beforeEach(() => {
  localStorage.clear();
  projectsResponse.mockReset();
  projectsResponse.mockResolvedValue({
    ok: true,
    json: async () => [buildProject()],
  });
  listeners.clear();
});

afterEach(() => {
  vi.resetModules();
});

test('the mount fetch runs once even when StrictMode remounts the tree', async () => {
  const { result } = await renderProjectsState(({ children }) => (
    <StrictMode>{children}</StrictMode>
  ));

  await waitFor(() => {
    assert.equal(result.current.isLoadingProjects, false);
  });

  assert.equal(projectsResponse.mock.calls.length, 1);
  assert.equal(result.current.projects.length, 1);
});

test('an explicit refresh still reaches the server after the mount fetch', async () => {
  const { result } = await renderProjectsState(({ children }) => (
    <StrictMode>{children}</StrictMode>
  ));

  await waitFor(() => {
    assert.equal(result.current.isLoadingProjects, false);
  });

  await result.current.refreshProjectsSilently();

  assert.equal(projectsResponse.mock.calls.length, 2);
});
