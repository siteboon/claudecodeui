import assert from 'node:assert/strict';

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import { SESSION_ARCHIVE_CHANGED_EVENT } from '@/shared/constants';
import type { Project, ProjectSession } from '@/shared/types';

/**
 * A session archived, restored or deleted on another tab or device used to
 * stay in this one's sidebar until a full refresh: the server announced it to
 * nobody. `session_archive_changed` drops it here, and a window event lets the
 * lists fetched on demand reload.
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

const APP_SESSION_ID = 'app-1';

const buildProject = (sessions: ProjectSession[]): Project => ({
  projectId: 'project-1',
  path: '/repo',
  fullPath: '/repo',
  displayName: 'Repo',
  isStarred: false,
  sessions,
  sessionMeta: { hasMore: false, total: sessions.length },
});

const respondWith = (projects: Project[]) => {
  projectsResponse.mockResolvedValue({ ok: true, json: async () => projects });
};

type ServerEventListener = (event: Record<string, unknown>) => void;

const listeners = new Set<ServerEventListener>();

const emit = (event: Record<string, unknown>) => {
  for (const listener of listeners) {
    listener(event);
  }
};

const buildUpsert = (providerSessionId: string | null) => ({
  kind: 'session_upserted',
  sessionId: APP_SESSION_ID,
  providerSessionId,
  provider: 'opencode',
  session: {
    id: APP_SESSION_ID,
    summary: 'merged session',
    messageCount: 0,
    lastActivity: '2026-01-01T00:00:00.000Z',
  },
  project: {
    projectId: 'project-1',
    path: '/repo',
    fullPath: '/repo',
    displayName: 'Repo',
    isStarred: false,
  },
  timestamp: '2026-01-01T00:00:00.000Z',
});

const renderProjectsState = async (navigate: ReturnType<typeof vi.fn>, urlSessionId: string) => {
  const { useProjectsState } = await import(
    '@/modules/project-workspace/hooks/useProjectsState'
  );

  return renderHook(() =>
    useProjectsState({
      sessionId: urlSessionId,
      navigate: navigate as never,
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

test('a session archived elsewhere leaves the sidebar, without navigating away', async () => {
  respondWith([buildProject([
    { id: APP_SESSION_ID, summary: 'to archive' } as ProjectSession,
    { id: 'app-2', summary: 'stays' } as ProjectSession,
  ])]);
  const navigate = vi.fn();
  const { result } = await renderProjectsState(navigate, APP_SESSION_ID);
  await waitFor(() => {
    assert.equal(result.current.projects[0]?.sessions?.length, 2);
  });
  navigate.mockClear();
  const reloads = vi.fn();
  window.addEventListener(SESSION_ARCHIVE_CHANGED_EVENT, reloads);

  try {
    await act(async () => {
      emit({ kind: 'session_archive_changed', sessionId: APP_SESSION_ID, state: 'archived', timestamp: '2026-01-01T00:00:00.000Z' });
    });

    assert.deepEqual((result.current.projects[0]?.sessions ?? []).map((session) => session.id), ['app-2']);
    assert.equal(navigate.mock.calls.length, 0, 'whoever has it open keeps reading it');
    assert.equal(reloads.mock.calls.length, 1, 'lists fetched on demand are told to reload');
  } finally {
    window.removeEventListener(SESSION_ARCHIVE_CHANGED_EVENT, reloads);
  }
});

test('a restore leaves the row to its upsert', async () => {
  respondWith([buildProject([{ id: 'app-2', summary: 'stays' } as ProjectSession])]);
  const navigate = vi.fn();
  const { result } = await renderProjectsState(navigate, 'app-2');
  await waitFor(() => {
    assert.equal(result.current.projects[0]?.sessions?.length, 1);
  });

  await act(async () => {
    emit({ kind: 'session_archive_changed', sessionId: APP_SESSION_ID, state: 'restored', timestamp: '2026-01-01T00:00:00.000Z' });
    emit(buildUpsert(null));
  });

  assert.deepEqual(
    (result.current.projects[0]?.sessions ?? []).map((session) => session.id).sort(),
    [APP_SESSION_ID, 'app-2'],
  );
});
