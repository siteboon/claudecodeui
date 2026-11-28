import assert from 'node:assert/strict';

import { act, renderHook, waitFor } from '@testing-library/react';
import { test, vi } from 'vitest';

import type { Project } from '@/shared/types';

/**
 * A new chat's session that is created after the user opened another chat is
 * listed in the sidebar, but does not take the selection over (#1744).
 */

const PROJECT: Project = {
  projectId: 'project-1',
  path: '/repo',
  fullPath: '/repo',
  displayName: 'Repo',
  isStarred: false,
  sessions: [{ id: 'session-other', summary: 'Other', __provider: 'claude' }],
  sessionMeta: { hasMore: false, total: 1 },
};

vi.mock('@/shared/api', () => ({
  api: {
    projects: () => Promise.resolve({ ok: true, json: async () => [PROJECT] }),
    projectTaskmaster: () => Promise.resolve({ ok: false }),
    sessionDetails: () => Promise.resolve({ ok: false }),
    projectSessions: () => Promise.resolve({ ok: false }),
  },
}));

const renderProjects = async () => {
  const { useProjectsState } = await import('@/modules/project-workspace/hooks/useProjectsState');
  const { result } = renderHook(() => useProjectsState({
    sessionId: undefined,
    navigate: vi.fn() as never,
    subscribe: () => () => undefined,
    isMobile: false,
    isSessionProcessing: () => false,
  }));
  await waitFor(() => assert.equal(result.current.projects.length, 1));
  act(() => result.current.handleSessionSelect({ ...PROJECT.sessions![0], __projectId: 'project-1' }));
  return result;
};

const register = (result: Awaited<ReturnType<typeof renderProjects>>, chatLeft: boolean) => act(() => {
  result.current.registerOptimisticSession({
    sessionId: 'session-new',
    provider: 'claude',
    project: PROJECT,
    summary: 'first message',
    chatLeft,
  });
});

test('a session created after the user left its chat is listed but not selected', async () => {
  const result = await renderProjects();
  register(result, true);

  assert.ok(result.current.projects[0].sessions?.some((session) => session.id === 'session-new'));
  assert.equal(result.current.selectedSession?.id, 'session-other');
});

test('a session created in the chat the user stayed in is selected', async () => {
  const result = await renderProjects();
  register(result, false);

  assert.equal(result.current.selectedSession?.id, 'session-new');
});
