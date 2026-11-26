import assert from 'node:assert/strict';

import { renderHook } from '@testing-library/react';
import { test, vi } from 'vitest';

const deleteProject = vi.fn();
const deleteSession = vi.fn();
let workspace: { projects: { projectId: string; fullPath: string; worktreeOf?: string | null }[]; refresh: () => Promise<void> } | null = null;

vi.mock('@/shared/api', () => ({
  api: { deleteProject: (...args: unknown[]) => deleteProject(...args), deleteSession: (...args: unknown[]) => deleteSession(...args) },
  readApiErrorMessage: (body: { error?: string } | null) => body?.error ?? null,
}));
vi.mock('@/modules/project-workspace', () => ({ useOptionalProjectActions: () => workspace }));

const { usePluginProjectActions, usePluginSessionActions } = await import('@/modules/plugins/usePluginProjectActions');

test('archive and delete resolve the project by path, call the sidebar request and refresh', async () => {
  const refresh = vi.fn(async () => undefined);
  workspace = { projects: [{ projectId: 'p-1', fullPath: '/src/app-worktrees/w1', worktreeOf: '/src/app' }], refresh };
  deleteProject.mockResolvedValue({ ok: true });
  const { result } = renderHook(() => usePluginProjectActions());

  assert.deepEqual(await result.current!('/src/app-worktrees/w1/', 'archive'), { ok: true });
  assert.deepEqual(await result.current!('/src/app-worktrees/w1', 'delete'), { ok: true });
  assert.deepEqual(deleteProject.mock.calls, [['p-1', false], ['p-1', true]]);
  assert.equal(refresh.mock.calls.length, 2);
});

test('unknown paths and failed requests are reported, not thrown', async () => {
  workspace = { projects: [{ projectId: 'p-1', fullPath: '/a', worktreeOf: '/repo' }], refresh: vi.fn(async () => undefined) };
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

test('a project that is not a git worktree can never be archived or deleted by a plugin', async () => {
  deleteProject.mockClear();
  workspace = { projects: [{ projectId: 'repo', fullPath: '/src/app', worktreeOf: null }], refresh: vi.fn(async () => undefined) };
  const { result } = renderHook(() => usePluginProjectActions());
  const res = await result.current!('/src/app', 'delete');
  assert.equal(res.ok, false);
  assert.match((res as { error: string }).error, /not a git worktree/);
  assert.equal(deleteProject.mock.calls.length, 0);
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
