import assert from 'node:assert/strict';

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import type { Project, ProjectSession } from '@/shared/types';

/**
 * A session moved to another project arrives as a `session_upserted` naming
 * the new project. The client has to drop it from the old project and, when it
 * is the open session, point the workspace at the new one: the chat sends the
 * selected project's folder as cwd.
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

const SESSION_ID = 'moved-1';

const buildProject = (projectId: string, fullPath: string, sessions: ProjectSession[]): Project => ({
  projectId,
  path: fullPath,
  fullPath,
  displayName: projectId,
  isStarred: false,
  sessions,
  sessionMeta: { hasMore: false, total: sessions.length },
});

type ServerEventListener = (event: Record<string, unknown>) => void;
const listeners = new Set<ServerEventListener>();
const emit = (event: Record<string, unknown>) => {
  for (const listener of listeners) listener(event);
};

const movedUpsert = {
  kind: 'session_upserted',
  sessionId: SESSION_ID,
  provider: 'claude',
  session: { id: SESSION_ID, summary: 'moved', messageCount: 0, lastActivity: '2026-01-01T00:00:00.000Z' },
  project: { projectId: 'project-b', path: '/b', fullPath: '/b', displayName: 'project-b', isStarred: false },
  timestamp: '2026-01-01T00:00:00.000Z',
};

beforeEach(() => {
  localStorage.clear();
  projectsResponse.mockReset();
  listeners.clear();
});

afterEach(() => {
  vi.resetModules();
});

test('an upsert that names another project moves the row and the open workspace there', async () => {
  projectsResponse.mockResolvedValue({
    ok: true,
    json: async () => [
      buildProject('project-a', '/a', [{ id: SESSION_ID, summary: 'moved' } as ProjectSession]),
      buildProject('project-b', '/b', []),
    ],
  });
  const { useProjectsState } = await import('@/modules/project-workspace/hooks/useProjectsState');
  const navigate = vi.fn();
  const { result } = renderHook(() =>
    useProjectsState({
      sessionId: SESSION_ID,
      navigate: navigate as never,
      subscribe: (listener: ServerEventListener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      isMobile: false,
      isSessionProcessing: () => false,
    }),
  );

  await waitFor(() => {
    assert.equal(result.current.selectedProject?.projectId, 'project-a');
  });

  await act(async () => {
    emit(movedUpsert);
  });

  const projectA = result.current.projects.find((project) => project.projectId === 'project-a');
  const projectB = result.current.projects.find((project) => project.projectId === 'project-b');
  assert.deepEqual((projectA?.sessions ?? []).map((session) => session.id), []);
  assert.deepEqual((projectB?.sessions ?? []).map((session) => session.id), [SESSION_ID]);
  assert.equal(result.current.selectedProject?.projectId, 'project-b');
  assert.equal(result.current.selectedProject?.fullPath, '/b');
  assert.equal(result.current.selectedSession?.__projectId, 'project-b');
  assert.deepEqual(navigate.mock.calls, [], 'moving the open session does not navigate');
});

test('a move also drops the old project row listed under the provider-native id', async () => {
  projectsResponse.mockResolvedValue({
    ok: true,
    json: async () => [
      buildProject('project-a', '/a', [{ id: 'native-1', summary: 'indexed' } as ProjectSession]),
      buildProject('project-b', '/b', []),
    ],
  });
  const { useProjectsState } = await import('@/modules/project-workspace/hooks/useProjectsState');
  const { result } = renderHook(() =>
    useProjectsState({
      sessionId: 'native-1',
      navigate: vi.fn() as never,
      subscribe: (listener: ServerEventListener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      isMobile: false,
      isSessionProcessing: () => false,
    }),
  );

  await waitFor(() => {
    assert.equal(result.current.selectedProject?.projectId, 'project-a');
  });

  await act(async () => {
    emit({ ...movedUpsert, providerSessionId: 'native-1' });
  });

  const projectA = result.current.projects.find((project) => project.projectId === 'project-a');
  assert.deepEqual((projectA?.sessions ?? []).map((session) => session.id), []);
  assert.equal(result.current.selectedProject?.projectId, 'project-b', 'the workspace follows the session it shows');
});
