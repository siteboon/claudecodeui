import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import { beforeEach, test, vi } from 'vitest';

import type { FileTreeNode, Project } from '@/shared/types';

/**
 * The new-item and rename inputs commit on Enter and again, 100 ms later, on
 * blur. Software keyboards, tabbing away right after Enter and browsers that
 * blur an input the moment it turns disabled all deliver both, and the second
 * commit used to send its own request: the first created the folder, the
 * second came back 409 "Directory already exists" as an error toast. The hook
 * owns the once-only guarantee now, so these drive it directly.
 */

const createFile = vi.fn();
const renameFile = vi.fn();

vi.mock('@/shared/api', () => ({
  api: {
    createFile: (...args: unknown[]) => createFile(...args),
    renameFile: (...args: unknown[]) => renameFile(...args),
  },
}));

const project: Project = { projectId: 'p1', displayName: 'demo', fullPath: '/demo', path: '/demo' };
const folder: FileTreeNode = { type: 'directory', name: 'old', path: '/demo/old' };

const ok = { ok: true, json: async () => ({}) };
const conflict = { ok: false, json: async () => ({ error: 'Directory already exists' }) };

// A response the test settles by hand, so both commits can land while the
// first request is still pending.
const deferred = () => {
  let resolve!: (response: typeof ok) => void;
  const promise = new Promise<typeof ok>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

const renderOperations = async () => {
  const { useFileTreeOperations } = await import('@/modules/file-tree/hooks/useFileTreeOperations');
  const showToast = vi.fn();
  const rendered = renderHook(() =>
    useFileTreeOperations({ selectedProject: project, onRefresh: () => {}, showToast }),
  );
  const successToasts = () => showToast.mock.calls.filter(([, type]) => type === 'success').length;
  return { ...rendered, successToasts };
};

beforeEach(() => {
  vi.resetModules();
});

test('two create commits before the request settles send one request and toast once', async () => {
  const { result, successToasts } = await renderOperations();
  const request = deferred();
  createFile.mockReturnValue(request.promise);

  act(() => result.current.handleStartCreate('', 'directory'));

  // Enter, then the deferred blur commit, with Enter's request still pending.
  let first!: Promise<void>;
  let second!: Promise<void>;
  act(() => {
    first = result.current.handleConfirmCreate();
    second = result.current.handleConfirmCreate();
  });
  assert.equal(createFile.mock.calls.length, 1, 'the second commit must not send its own request');

  request.resolve(ok);
  await act(() => Promise.all([first, second]));

  assert.equal(createFile.mock.calls.length, 1);
  assert.equal(successToasts(), 1);
  assert.equal(result.current.isCreating, false);
});

test('two rename commits before the request settles send one request and toast once', async () => {
  const { result, successToasts } = await renderOperations();
  const request = deferred();
  renameFile.mockReturnValue(request.promise);

  act(() => result.current.handleStartRename(folder));
  act(() => result.current.setRenameValue('new'));

  let first!: Promise<void>;
  let second!: Promise<void>;
  act(() => {
    first = result.current.handleConfirmRename();
    second = result.current.handleConfirmRename();
  });
  assert.equal(renameFile.mock.calls.length, 1, 'the second commit must not send its own request');

  request.resolve(ok);
  await act(() => Promise.all([first, second]));

  assert.equal(renameFile.mock.calls.length, 1);
  assert.equal(successToasts(), 1);
  assert.equal(result.current.renamingItem, null);
});

test('a create commit that lands after the item was created is ignored', async () => {
  const { result } = await renderOperations();
  createFile.mockResolvedValue(ok);

  act(() => result.current.handleStartCreate('', 'file'));
  // The blur timer holds the callback from the render in which the input was
  // open, and fires it 100 ms later — by then Enter has already finished.
  const commitFromBlur = result.current.handleConfirmCreate;

  await act(() => result.current.handleConfirmCreate());
  assert.equal(result.current.isCreating, false);

  await act(() => commitFromBlur());
  assert.equal(createFile.mock.calls.length, 1, 'nothing is open to create any more');
});

test('a rename commit that lands after the item was renamed is ignored', async () => {
  const { result } = await renderOperations();
  renameFile.mockResolvedValue(ok);

  act(() => result.current.handleStartRename(folder));
  act(() => result.current.setRenameValue('new'));
  const commitFromBlur = result.current.handleConfirmRename;

  await act(() => result.current.handleConfirmRename());
  assert.equal(result.current.renamingItem, null);

  await act(() => commitFromBlur());
  assert.equal(renameFile.mock.calls.length, 1, 'nothing is open to rename any more');
});

test('a failed create releases the guard so the retry is sent', async () => {
  const { result, successToasts } = await renderOperations();
  createFile.mockResolvedValueOnce(conflict).mockResolvedValueOnce(ok);

  act(() => result.current.handleStartCreate('', 'directory'));

  await act(() => result.current.handleConfirmCreate());
  // The input stays open after an error so the user can fix the name.
  assert.equal(result.current.isCreating, true);

  act(() => result.current.setNewItemName('other'));
  await act(() => result.current.handleConfirmCreate());

  assert.equal(createFile.mock.calls.length, 2);
  assert.equal(successToasts(), 1);
  assert.equal(result.current.isCreating, false);
});

test('a rename started while a create is still in flight can still be submitted', async () => {
  const { result } = await renderOperations();
  const request = deferred();
  createFile.mockReturnValue(request.promise);
  renameFile.mockResolvedValue(ok);

  // The header buttons disable while a request runs, but the context menu
  // does not, so the other editor can open before the first request lands.
  act(() => result.current.handleStartCreate('', 'directory'));
  let create!: Promise<void>;
  act(() => {
    create = result.current.handleConfirmCreate();
  });
  act(() => result.current.handleStartRename(folder));
  act(() => result.current.setRenameValue('renamed'));
  request.resolve(ok);
  await act(() => create);

  await act(() => result.current.handleConfirmRename());

  assert.equal(renameFile.mock.calls.length, 1, 'closing the finished create must not strand the rename editor');
  assert.equal(result.current.renamingItem, null);
});

test('a create started while a rename is still in flight can still be submitted', async () => {
  const { result } = await renderOperations();
  const request = deferred();
  renameFile.mockReturnValue(request.promise);
  createFile.mockResolvedValue(ok);

  act(() => result.current.handleStartRename(folder));
  act(() => result.current.setRenameValue('renamed'));
  let rename!: Promise<void>;
  act(() => {
    rename = result.current.handleConfirmRename();
  });
  act(() => result.current.handleStartCreate('', 'directory'));
  request.resolve(ok);
  await act(() => rename);

  await act(() => result.current.handleConfirmCreate());

  assert.equal(createFile.mock.calls.length, 1, 'closing the finished rename must not strand the create editor');
  assert.equal(result.current.isCreating, false);
});
