import assert from 'node:assert/strict';

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import type { Project, ProjectSession } from '@/shared/types';

/**
 * A rename confirmed by the backend has to land on both local copies of the
 * session at once: the row in `projects` the sidebar renders, and the
 * `selectedSession` the workspace header and document title read. The rename
 * route does not broadcast a `session_upserted`, so nothing else would bring
 * the header up to date.
 */

const projectsResponse = vi.fn();
const renameSessionResponse = vi.fn();

vi.mock('@/shared/api', () => ({
  api: {
    projects: () => projectsResponse(),
    renameSession: (...args: unknown[]) => renameSessionResponse(...args),
    projectTaskmaster: () => Promise.resolve({ ok: false }),
    sessionDetails: () => Promise.resolve({ ok: false }),
    projectSessions: () => Promise.resolve({ ok: false }),
  },
}));

const session: ProjectSession = { id: 'session-1', summary: 'Original title', __provider: 'claude' };
const otherSession: ProjectSession = { id: 'session-2', summary: 'Untouched', __provider: 'claude' };

const buildProject = (overrides: Partial<Project> = {}): Project => ({
  projectId: 'project-1',
  path: '/repo',
  fullPath: '/repo',
  displayName: 'repo',
  isStarred: false,
  sessions: [session, otherSession],
  sessionMeta: { hasMore: false, total: 2 },
  ...overrides,
});

const renderProjectsState = async () => {
  const { useProjectsState } = await import('@/modules/project-workspace/hooks/useProjectsState');

  return renderHook(() =>
    useProjectsState({
      sessionId: undefined,
      navigate: vi.fn(),
      subscribe: () => () => {},
      isMobile: false,
      isSessionProcessing: () => false,
    }),
  );
};

const renderWithSelectedSession = async () => {
  projectsResponse.mockResolvedValue({ ok: true, json: async () => [buildProject()] });
  const { result } = await renderProjectsState();

  await waitFor(() => {
    assert.equal(result.current.projects.length, 1);
  });
  act(() => {
    result.current.handleSessionSelect({ ...session, __projectId: 'project-1' });
  });
  assert.equal(result.current.selectedSession?.summary, 'Original title');

  return result;
};

beforeEach(() => {
  localStorage.clear();
  projectsResponse.mockReset();
  renameSessionResponse.mockReset();
});

afterEach(() => {
  vi.resetModules();
});

test('a confirmed rename updates the selected session and its sidebar row in place', async () => {
  renameSessionResponse.mockResolvedValue({ ok: true, json: async () => ({}) });
  const result = await renderWithSelectedSession();
  const untouchedProjectsBefore = result.current.projects;

  let renamed: boolean | undefined;
  await act(async () => {
    renamed = await result.current.renameSession('session-1', '  Renamed from header  ');
  });

  assert.equal(renamed, true);
  assert.deepEqual(renameSessionResponse.mock.calls, [['session-1', 'Renamed from header']]);
  assert.equal(result.current.selectedSession?.summary, 'Renamed from header');
  assert.deepEqual(
    result.current.projects[0].sessions?.map((row) => row.summary),
    ['Renamed from header', 'Untouched'],
  );
  // No refetch is needed for the header to catch up.
  assert.equal(projectsResponse.mock.calls.length, 1);
  assert.notEqual(result.current.projects, untouchedProjectsBefore);
});

test('a rename the backend refuses leaves both copies alone and reports false', async () => {
  renameSessionResponse.mockResolvedValue({ ok: false, status: 400 });
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  const result = await renderWithSelectedSession();
  const projectsBefore = result.current.projects;
  const selectedBefore = result.current.selectedSession;

  let renamed: boolean | undefined;
  await act(async () => {
    renamed = await result.current.renameSession('session-1', 'Refused');
  });

  assert.equal(renamed, false);
  assert.equal(result.current.projects, projectsBefore);
  assert.equal(result.current.selectedSession, selectedBefore);
  assert.equal(consoleError.mock.calls.length, 1);
});

test('a blank title is rejected before any request is made', async () => {
  const result = await renderWithSelectedSession();

  let renamed: boolean | undefined;
  await act(async () => {
    renamed = await result.current.renameSession('session-1', '   ');
  });

  assert.equal(renamed, false);
  assert.equal(renameSessionResponse.mock.calls.length, 0);
  assert.equal(result.current.selectedSession?.summary, 'Original title');
});

test('renaming a session other than the selected one leaves the selection untouched', async () => {
  renameSessionResponse.mockResolvedValue({ ok: true, json: async () => ({}) });
  const result = await renderWithSelectedSession();
  const selectedBefore = result.current.selectedSession;

  await act(async () => {
    await result.current.renameSession('session-2', 'Other renamed');
  });

  assert.equal(result.current.selectedSession, selectedBefore);
  assert.equal(result.current.projects[0].sessions?.[1].summary, 'Other renamed');
});
