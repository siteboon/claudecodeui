import assert from 'node:assert/strict';

import { renderHook } from '@testing-library/react';
import { test, vi } from 'vitest';

const deleteProject = vi.fn();
const deleteSession = vi.fn();
let workspace: {
  projects: { projectId: string; fullPath: string }[];
  refresh: () => Promise<void>;
  removeProject?: (id: string) => void;
  removeSession?: (id: string) => void;
} | null = null;

vi.mock('@/shared/api', () => ({
  api: { deleteProject: (...args: unknown[]) => deleteProject(...args), deleteSession: (...args: unknown[]) => deleteSession(...args) },
  readApiErrorMessage: (body: { error?: string } | null) => body?.error ?? null,
}));
vi.mock('@/modules/project-workspace', () => ({ useOptionalProjectActions: () => workspace }));

const { usePluginProjectActions, usePluginSessionActions } = await import('@/modules/plugins/usePluginProjectActions');

test('archive and delete resolve the project by path, call the sidebar request and refresh', async () => {
  const refresh = vi.fn(async () => undefined);
  workspace = { projects: [{ projectId: 'p-1', fullPath: '/src/app-worktrees/w1' }], refresh };
  deleteProject.mockResolvedValue({ ok: true });
  const { result } = renderHook(() => usePluginProjectActions());

  assert.deepEqual(await result.current!('/src/app-worktrees/w1/', 'archive'), { ok: true });
  assert.deepEqual(await result.current!('/src/app-worktrees/w1', 'delete'), { ok: true });
  assert.deepEqual(deleteProject.mock.calls, [['p-1', false], ['p-1', true]]);
  assert.equal(refresh.mock.calls.length, 2);
});

test('unknown paths and failed requests are reported, not thrown', async () => {
  workspace = { projects: [{ projectId: 'p-1', fullPath: '/a' }], refresh: vi.fn(async () => undefined) };
  deleteProject.mockResolvedValue({ ok: false, status: 404, json: async () => ({ error: 'Unknown projectId' }) });
  const { result } = renderHook(() => usePluginProjectActions());
  assert.deepEqual(await result.current!('/nope', 'archive'), { ok: false, error: 'No project at /nope' });
  assert.deepEqual(await result.current!('/a', 'archive'), { ok: false, error: 'Unknown projectId' });
});

test('outside the project workspace there are no actions', () => {
  workspace = null;
  const { result } = renderHook(() => usePluginProjectActions());
  assert.equal(result.current, null);
});


test('session archive and delete call the sidebar session request and refresh', async () => {
  const refresh = vi.fn(async () => undefined);
  workspace = { projects: [], refresh };
  deleteSession.mockResolvedValue({ ok: true });
  const { result } = renderHook(() => usePluginSessionActions());
  assert.deepEqual(await result.current!('s-1', 'archive'), { ok: true });
  assert.deepEqual(await result.current!('s-1', 'delete'), { ok: true });
  assert.deepEqual(deleteSession.mock.calls, [['s-1', false], ['s-1', true]]);
  assert.equal(refresh.mock.calls.length, 2);
  deleteSession.mockResolvedValue({ ok: false, status: 404, json: async () => ({ error: 'Session not found' }) });
  assert.deepEqual(await result.current!('nope', 'archive'), { ok: false, error: 'Session not found' });
});

test('successful actions drop the target locally before refreshing, so a refresh merge cannot bring it back', async () => {
  const order: string[] = [];
  const refresh = vi.fn(async () => { order.push('refresh'); });
  workspace = {
    projects: [{ projectId: 'p-1', fullPath: '/src/app-worktrees/w1' }],
    refresh,
    removeProject: (id) => order.push(`removeProject:${id}`),
    removeSession: (id) => order.push(`removeSession:${id}`),
  };
  deleteProject.mockResolvedValue({ ok: true });
  deleteSession.mockResolvedValue({ ok: true });
  const projects = renderHook(() => usePluginProjectActions()).result;
  const sessions = renderHook(() => usePluginSessionActions()).result;
  await projects.current!('/src/app-worktrees/w1', 'archive');
  await sessions.current!('s-2', 'archive');
  assert.deepEqual(order, ['removeProject:p-1', 'refresh', 'removeSession:s-2', 'refresh']);

  order.length = 0;
  deleteSession.mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: 'nope' }) });
  await sessions.current!('s-3', 'delete');
  assert.deepEqual(order, [], 'nothing is removed locally when the request fails');
});

test('cleanup after a pending request uses the latest workspace callbacks (selection may have changed)', async () => {
  const calls: string[] = [];
  const makeWorkspace = (tag: string) => ({
    projects: [{ projectId: 'p-1', fullPath: '/src/app-worktrees/w1' }],
    refresh: vi.fn(async () => { calls.push(`${tag}:refresh`); }),
    removeProject: (id: string) => calls.push(`${tag}:removeProject:${id}`),
    removeSession: (id: string) => calls.push(`${tag}:removeSession:${id}`),
  });
  let resolveProject!: (v: unknown) => void;
  let resolveSession!: (v: unknown) => void;
  deleteProject.mockReturnValue(new Promise((r) => { resolveProject = r; }));
  deleteSession.mockReturnValue(new Promise((r) => { resolveSession = r; }));

  workspace = makeWorkspace('before');
  const projectHook = renderHook(() => usePluginProjectActions());
  const sessionHook = renderHook(() => usePluginSessionActions());
  const projectDone = projectHook.result.current!('/src/app-worktrees/w1', 'delete');
  const sessionDone = sessionHook.result.current!('s-1', 'delete');

  // The user selects something else while both requests are in flight: the hooks re-render with new callbacks.
  workspace = makeWorkspace('after');
  projectHook.rerender();
  sessionHook.rerender();
  resolveProject({ ok: true });
  resolveSession({ ok: true });
  await projectDone;
  await sessionDone;

  assert.deepEqual(calls, ['after:removeProject:p-1', 'after:refresh', 'after:removeSession:s-1', 'after:refresh']);
});

test('a request that rejects (network failure) yields an error result, not an exception', async () => {
  const removeProject = vi.fn();
  const removeSession = vi.fn();
  workspace = {
    projects: [{ projectId: 'p-1', fullPath: '/src/app-worktrees/w1' }],
    refresh: vi.fn(async () => undefined),
    removeProject,
    removeSession,
  };
  deleteProject.mockRejectedValue(new TypeError('Failed to fetch'));
  deleteSession.mockRejectedValue(new TypeError('Failed to fetch'));
  const projects = renderHook(() => usePluginProjectActions()).result;
  const sessions = renderHook(() => usePluginSessionActions()).result;
  assert.deepEqual(await projects.current!('/src/app-worktrees/w1', 'delete'), { ok: false, error: 'Failed to fetch' });
  assert.deepEqual(await sessions.current!('s-1', 'delete'), { ok: false, error: 'Failed to fetch' });
  assert.equal(removeProject.mock.calls.length + removeSession.mock.calls.length, 0, 'nothing removed locally');
});
