import assert from 'node:assert/strict';

import { render, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { beforeEach, test, vi } from 'vitest';

import type { ServerEvent } from '@/shared/types';

/**
 * `taskmaster-project-updated` used to trigger two fetches: the per-project one
 * and refreshProjects(), which — once refreshProjects stopped fetching the whole
 * /api/projects list — had become the very same call. For an event about a
 * different project it also refetched the selected project, which the event said
 * nothing about.
 *
 * The seq guard meant the applied value was always correct, so nothing was
 * visibly broken and only a request count can catch it.
 */

const projectTaskmaster = vi.fn(async () => ({
  ok: true,
  json: async () => ({ taskmaster: { hasTaskmaster: true } }),
}));

let emit: ((event: ServerEvent) => void) | null = null;

vi.mock('@/shared/api', () => ({
  api: {
    projectTaskmaster,
    taskmaster: {
      tasks: vi.fn(async () => ({ ok: true, json: async () => ({ tasks: [] }) })),
      mcpStatus: vi.fn(async () => ({ ok: true, json: async () => ({}) })),
    },
  },
}));

// Hoisted to a constant: returning a fresh object per call would give `user` a
// new identity every render, which makes every useCallback depending on it
// unstable and turns the effect below into an infinite loop.
const AUTH = { user: { id: 1 }, token: 'token', isLoading: false };

vi.mock('@/modules/auth', () => ({
  useAuth: () => AUTH,
}));

const WEBSOCKET = {
  subscribe: (handler: (event: ServerEvent) => void) => {
    emit = handler;
    return () => {
      emit = null;
    };
  },
};

vi.mock('@/shared/context/WebSocketContext', () => ({
  useWebSocket: () => WEBSOCKET,
}));

const { TaskMasterProvider, useTaskMaster } = await import(
  '@/modules/task-master/context/TaskMasterContext'
);

const SELECTED = { projectId: 'p1', name: 'p1', displayName: 'p1', fullPath: '/tmp/p1' };

function SelectProject() {
  const { setCurrentProject } = useTaskMaster();

  useEffect(() => {
    setCurrentProject({ ...SELECTED } as never);
  }, [setCurrentProject]);

  return null;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

/** Mounts, lets every start-up fetch finish, then hands back a zeroed counter. */
const mountAndQuiesce = async () => {
  render(
    <TaskMasterProvider>
      <SelectProject />
    </TaskMasterProvider>,
  );

  await waitFor(() => assert.ok(emit));
  await waitFor(() => assert.ok(projectTaskmaster.mock.calls.length > 0));
  await settle();
  projectTaskmaster.mockClear();
};

beforeEach(() => {
  projectTaskmaster.mockClear();
  emit = null;
});

test('an update for the selected project is fetched once, not twice', async () => {
  await mountAndQuiesce();

  emit?.({ type: 'taskmaster-project-updated', projectId: 'p1' } as unknown as ServerEvent);
  await settle();

  assert.equal(projectTaskmaster.mock.calls.length, 1, 'one broadcast, one request');
  assert.deepEqual(projectTaskmaster.mock.calls[0], ['p1']);
});

test('an update for another project fetches nothing', async () => {
  await mountAndQuiesce();

  emit?.({ type: 'taskmaster-project-updated', projectId: 'other' } as unknown as ServerEvent);
  await settle();

  assert.deepEqual(
    projectTaskmaster.mock.calls,
    [],
    'the selected project has nothing to re-read for another project\'s event',
  );
});
