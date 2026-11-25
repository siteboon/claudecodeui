import assert from 'node:assert/strict';

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import type { Project, ProjectSession } from '@/shared/types';

/**
 * A project list (or session page) requested before a `session_upserted` and
 * answered after it must not put back the state the upsert replaced (#1641).
 */

const projectsResponse = vi.fn();
const projectSessionsResponse = vi.fn();

vi.mock('@/shared/api', () => ({
  api: {
    projects: () => projectsResponse(),
    projectTaskmaster: () => Promise.resolve({ ok: false }),
    sessionDetails: () => Promise.resolve({ ok: false }),
    projectSessions: () => projectSessionsResponse(),
  },
}));

const buildProject = (summary: string, hasMore = false): Project => ({
  projectId: 'project-1',
  path: '/repo',
  fullPath: '/repo',
  displayName: 'Repo',
  isStarred: false,
  sessions: [{ id: 'session-1', summary, __provider: 'claude' } as ProjectSession],
  sessionMeta: { hasMore, total: hasMore ? 2 : 1 },
});

const respond = (body: unknown) => ({ ok: true, json: async () => body });

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

type ServerEventListener = (event: Record<string, unknown>) => void;
const listeners = new Set<ServerEventListener>();
const emit = (event: Record<string, unknown>) => {
  for (const listener of listeners) listener(event);
};

const renamedUpsert = {
  kind: 'session_upserted',
  sessionId: 'session-1',
  provider: 'claude',
  session: { id: 'session-1', summary: 'Renamed' },
  project: { projectId: 'project-1', path: '/repo', fullPath: '/repo', displayName: 'Repo', isStarred: false },
};

const summaryOf = (projects: Project[]) =>
  projects[0]?.sessions?.find((session) => session.id === 'session-1')?.summary;

const renderLoaded = async (initial: Project) => {
  projectsResponse.mockResolvedValueOnce(respond([initial]));
  const { useProjectsState } = await import('@/modules/project-workspace/hooks/useProjectsState');
  const hook = renderHook(() =>
    useProjectsState({
      sessionId: undefined,
      navigate: vi.fn() as never,
      subscribe: (listener: ServerEventListener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      isMobile: false,
      isSessionProcessing: () => false,
    }),
  );
  await waitFor(() => assert.equal(summaryOf(hook.result.current.projects), 'Original'));
  return hook;
};

beforeEach(() => {
  localStorage.clear();
  projectsResponse.mockReset();
  projectSessionsResponse.mockReset();
  listeners.clear();
});

afterEach(() => {
  vi.resetModules();
});

test('a reconnect re-sync answered after an upsert keeps the upsert', async () => {
  const { result } = await renderLoaded(buildProject('Original'));
  const slow = deferred<unknown>();
  projectsResponse.mockReturnValueOnce(slow.promise);

  act(() => emit({ kind: 'websocket_reconnected' }));
  act(() => emit(renamedUpsert));
  assert.equal(summaryOf(result.current.projects), 'Renamed');

  await act(async () => {
    slow.resolve(respond([buildProject('Original')]));
  });
  assert.equal(summaryOf(result.current.projects), 'Renamed');
});

test('a sidebar refresh answered after an upsert keeps the upsert', async () => {
  const { result } = await renderLoaded(buildProject('Original'));
  const slow = deferred<unknown>();
  projectsResponse.mockReturnValueOnce(slow.promise);

  let refresh!: Promise<void>;
  act(() => {
    refresh = result.current.handleSidebarRefresh();
  });
  act(() => emit(renamedUpsert));

  await act(async () => {
    slow.resolve(respond([buildProject('Original')]));
    await refresh;
  });
  assert.equal(summaryOf(result.current.projects), 'Renamed');
});

test('a session page answered after an upsert keeps the upsert', async () => {
  const { result } = await renderLoaded(buildProject('Original', true));
  const slow = deferred<unknown>();
  projectSessionsResponse.mockReturnValueOnce(slow.promise);

  let loadMore!: Promise<void>;
  act(() => {
    loadMore = result.current.loadMoreProjectSessions('project-1');
  });
  act(() => emit(renamedUpsert));

  await act(async () => {
    slow.resolve(respond({
      sessions: [
        { id: 'session-1', summary: 'Original', __provider: 'claude' },
        { id: 'session-2', summary: 'Older', __provider: 'claude' },
      ],
      sessionMeta: { hasMore: false, total: 2 },
    }));
    await loadMore;
  });
  assert.equal(summaryOf(result.current.projects), 'Renamed');
});
