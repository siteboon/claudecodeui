import assert from 'node:assert/strict';

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import type { Project, ProjectSession } from '@/shared/types';

/**
 * Regression guard for read-only sessions (Cursor IDE chats) opened from a
 * list that doesn't carry the flag: archived sessions, recent conversations,
 * pins and search results build a session without `readOnly`. The selected
 * session must still end up read-only, or the chat shows a composer whose
 * messages the server refuses.
 */

const projectsResponse = vi.fn();
const sessionDetailsResponse = vi.fn();

vi.mock('@/shared/api', () => ({
  api: {
    projects: () => projectsResponse(),
    projectTaskmaster: () => Promise.resolve({ ok: false }),
    sessionDetails: (sessionId: string) => sessionDetailsResponse(sessionId),
    projectSessions: () => Promise.resolve({ ok: false }),
  },
}));

const IDE_SESSION_ID = 'ide-chat-1';

const buildProject = (sessions: ProjectSession[]): Project => ({
  projectId: 'project-1',
  path: '/repo',
  fullPath: '/repo',
  displayName: 'Repo',
  isStarred: false,
  sessions,
  sessionMeta: { hasMore: false, total: sessions.length },
});

const renderProjectsState = async (initialUrlSessionId: string | null) => {
  const { useProjectsState } = await import(
    '@/modules/project-workspace/hooks/useProjectsState'
  );

  return renderHook(
    ({ urlSessionId }: { urlSessionId: string | null }) =>
      useProjectsState({
        sessionId: urlSessionId ?? undefined,
        navigate: vi.fn() as never,
        subscribe: () => () => {},
        isMobile: false,
        isSessionProcessing: () => false,
      }),
    { initialProps: { urlSessionId: initialUrlSessionId } },
  );
};

beforeEach(() => {
  localStorage.clear();
  projectsResponse.mockReset();
  sessionDetailsResponse.mockReset();
  sessionDetailsResponse.mockResolvedValue({ ok: false });
});

afterEach(() => {
  vi.resetModules();
});

test('a session missing from the loaded pages is looked up for its read-only flag', async () => {
  projectsResponse.mockResolvedValue({ ok: true, json: async () => [buildProject([])] });
  sessionDetailsResponse.mockResolvedValue({
    ok: true,
    json: async () => ({
      data: {
        sessionId: IDE_SESSION_ID,
        provider: 'cursor',
        summary: 'IDE chat',
        readOnly: true,
        project: { projectId: 'project-1', path: '/repo', fullPath: '/repo', displayName: 'Repo' },
      },
    }),
  });
  const { result, rerender } = await renderProjectsState(null);
  await waitFor(() => {
    assert.equal(result.current.projects.length, 1);
  });

  // Shaped like an archived-session click: the session is selected without
  // `readOnly`, then the URL follows.
  act(() => {
    result.current.handleSessionSelect({ id: IDE_SESSION_ID, __provider: 'cursor' } as ProjectSession);
  });
  rerender({ urlSessionId: IDE_SESSION_ID });

  await waitFor(() => {
    assert.equal(result.current.selectedSession?.readOnly, true);
  });
  assert.deepEqual(sessionDetailsResponse.mock.calls, [[IDE_SESSION_ID]]);
});

test('a loaded read-only row replaces a selection that lacks the flag', async () => {
  projectsResponse.mockResolvedValue({
    ok: true,
    json: async () => [buildProject([
      { id: IDE_SESSION_ID, summary: 'IDE chat', readOnly: true, __provider: 'cursor' } as ProjectSession,
    ])],
  });
  const { result } = await renderProjectsState(IDE_SESSION_ID);

  await waitFor(() => {
    assert.equal(result.current.projects[0]?.sessions?.[0]?.id, IDE_SESSION_ID);
  });

  // Shaped like a pinned-session click: no `readOnly` on the object.
  act(() => {
    result.current.handleSessionSelect({ id: IDE_SESSION_ID, __provider: 'cursor' } as ProjectSession);
  });

  await waitFor(() => {
    assert.equal(result.current.selectedSession?.readOnly, true);
  });
});
