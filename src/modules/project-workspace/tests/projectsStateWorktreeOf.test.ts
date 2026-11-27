import assert from 'node:assert/strict';

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import type { Project } from '@/shared/types';

/** A project's resolved worktree parent must reach the sidebar both from a refresh and from a session upsert. */

const projectsResponse = vi.fn();

vi.mock('@/shared/api', () => ({
  api: {
    projects: () => projectsResponse(),
    projectTaskmaster: () => Promise.resolve({ ok: false }),
    sessionDetails: () => Promise.resolve({ ok: false }),
    projectSessions: () => Promise.resolve({ ok: false }),
  },
}));

const worktree = (worktreeOf: string | null): Project => ({
  projectId: 'wt-1',
  path: '/src/app-worktrees/a',
  fullPath: '/src/app-worktrees/a',
  displayName: 'a',
  isStarred: false,
  worktreeOf,
  sessions: [],
  sessionMeta: { hasMore: false, total: 0 },
});

type Listener = (event: Record<string, unknown>) => void;
const listeners = new Set<Listener>();

const renderProjectsState = async () => {
  const { useProjectsState } = await import('@/modules/project-workspace/hooks/useProjectsState');
  return renderHook(() => useProjectsState({
    sessionId: undefined as never,
    navigate: vi.fn() as never,
    subscribe: (listener: Listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    isMobile: false,
    isSessionProcessing: () => false,
  }));
};

beforeEach(() => {
  localStorage.clear();
  projectsResponse.mockReset();
  listeners.clear();
});
afterEach(() => { vi.resetModules(); });

test('a refresh that only changes worktreeOf replaces the project', async () => {
  projectsResponse.mockResolvedValue({ ok: true, json: async () => [worktree(null)] });
  const { result } = await renderProjectsState();
  await waitFor(() => assert.equal(result.current.projects.length, 1));

  projectsResponse.mockResolvedValue({ ok: true, json: async () => [worktree('/src/app')] });
  await act(async () => { await result.current.refreshProjectsSilently(); });
  assert.equal(result.current.projects[0]?.worktreeOf, '/src/app');
});

test('a session upsert applies worktreeOf to an existing project and leaves it alone when omitted', async () => {
  projectsResponse.mockResolvedValue({ ok: true, json: async () => [worktree(null)] });
  const { result } = await renderProjectsState();
  await waitFor(() => assert.equal(result.current.projects.length, 1));

  const upsert = (project: Record<string, unknown>) => ({
    kind: 'session_upserted',
    sessionId: 's-1',
    providerSessionId: null,
    provider: 'claude',
    session: { id: 's-1', summary: 's', messageCount: 0, lastActivity: '2026-01-01T00:00:00.000Z' },
    project: { projectId: 'wt-1', path: '/src/app-worktrees/a', fullPath: '/src/app-worktrees/a', displayName: 'a', isStarred: false, ...project },
    timestamp: '2026-01-01T00:00:00.000Z',
  });

  await act(async () => { for (const l of listeners) l(upsert({ worktreeOf: '/src/app' })); });
  assert.equal(result.current.projects[0]?.worktreeOf, '/src/app');

  await act(async () => { for (const l of listeners) l(upsert({})); });
  assert.equal(result.current.projects[0]?.worktreeOf, '/src/app');
});
