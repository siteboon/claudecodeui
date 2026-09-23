import assert from 'node:assert/strict';

import { act, renderHook, waitFor } from '@testing-library/react';
import type { KeyboardEvent, RefObject } from 'react';
import { test, vi } from 'vitest';

import type { Project } from '@/shared/types';

/**
 * Regression guard for #1367: a file added after the composer loaded the
 * project's file list (an upload, an agent edit, a terminal command) must be
 * offered by the `@` dropdown the next time the user types `@`, without a page
 * reload or a project switch.
 */

const getFiles = vi.fn();

vi.mock('@/shared/api', () => ({
  api: { getFiles: (...args: unknown[]) => getFiles(...args) },
}));

const { useFileMentions } = await import('@/modules/chat/hooks/useFileMentions');

const ROOT = '/home/user/project';
const project: Project = { projectId: 'p1', displayName: 'project', fullPath: ROOT };

const fileNode = (name: string) => ({ type: 'file', name, path: `${ROOT}/${name}` });
const treeResponse = (names: string[]) => ({ ok: true, json: async () => names.map(fileNode) });

// A getFiles response the test resolves by hand, to hold a request in flight.
const deferredTreeResponse = () => {
  let resolve: (names: string[]) => void = () => {};
  const promise = new Promise<ReturnType<typeof treeResponse>>((resolvePromise) => {
    resolve = (names) => resolvePromise(treeResponse(names));
  });
  return { promise, resolve };
};

const keyEvent = (key: string) =>
  ({ key, preventDefault: () => {} }) as unknown as KeyboardEvent<HTMLTextAreaElement>;

const renderMentions = () => {
  const textareaRef: RefObject<HTMLTextAreaElement> = { current: null };
  const hook = renderHook(
    ({ input }: { input: string }) =>
      useFileMentions({ selectedProject: project, input, setInput: vi.fn(), textareaRef }),
    { initialProps: { input: '' } },
  );

  // Mirrors the composer: the input changes and the caret follows it.
  const type = (input: string) => {
    hook.rerender({ input });
    act(() => {
      hook.result.current.setCursorPosition(input.length);
    });
  };

  const shownNames = () => hook.result.current.filteredFiles.map((file) => file.name);

  return { ...hook, type, shownNames };
};

test('a file added after the list was loaded shows up the next time `@` opens the dropdown', async () => {
  getFiles.mockReset();
  getFiles.mockResolvedValueOnce(treeResponse(['a.txt']));
  getFiles.mockResolvedValue(treeResponse(['a.txt', 'uploaded.txt']));

  const { type, shownNames } = renderMentions();
  await waitFor(() => assert.equal(getFiles.mock.calls.length, 1));

  type('@upl');

  await waitFor(() => assert.deepEqual(shownNames(), ['uploaded.txt']));
  assert.equal(getFiles.mock.calls.length, 2);
});

test('typing the query while the dropdown stays open does not refetch on every keystroke', async () => {
  getFiles.mockReset();
  getFiles.mockResolvedValue(treeResponse(['a.txt', 'b.txt']));

  const { type, shownNames } = renderMentions();
  await waitFor(() => assert.equal(getFiles.mock.calls.length, 1));

  type('@');
  await waitFor(() => assert.equal(getFiles.mock.calls.length, 2));
  type('@a');
  type('@a.');
  type('@a.t');

  await waitFor(() => assert.deepEqual(shownNames(), ['a.txt']));
  assert.equal(getFiles.mock.calls.length, 2);

  // Closing the dropdown (a space ends the query) and typing `@` again refetches once more.
  type('@a.t ');
  type('@a.t @');
  await waitFor(() => assert.equal(getFiles.mock.calls.length, 3));
});

test('the previous list stays visible while the refetch is in flight', async () => {
  getFiles.mockReset();
  getFiles.mockResolvedValueOnce(treeResponse(['a.txt']));
  const refetch = deferredTreeResponse();
  getFiles.mockReturnValueOnce(refetch.promise);

  const { type, shownNames } = renderMentions();
  await waitFor(() => assert.equal(getFiles.mock.calls.length, 1));

  type('@');
  await waitFor(() => assert.equal(getFiles.mock.calls.length, 2));
  assert.deepEqual(shownNames(), ['a.txt']);

  await act(async () => {
    refetch.resolve(['a.txt', 'new.txt']);
  });
  await waitFor(() => assert.deepEqual(shownNames(), ['a.txt', 'new.txt']));
});

test('an older refetch that lands after a newer one cannot overwrite it', async () => {
  getFiles.mockReset();
  getFiles.mockResolvedValueOnce(treeResponse(['a.txt']));
  const olderRefetch = deferredTreeResponse();
  const newerRefetch = deferredTreeResponse();
  getFiles.mockReturnValueOnce(olderRefetch.promise);
  getFiles.mockReturnValueOnce(newerRefetch.promise);

  const { type, shownNames } = renderMentions();
  await waitFor(() => assert.equal(getFiles.mock.calls.length, 1));

  type('@');
  await waitFor(() => assert.equal(getFiles.mock.calls.length, 2));
  type('@ ');
  type('@ @');
  await waitFor(() => assert.equal(getFiles.mock.calls.length, 3));

  // The newer request superseded the older one.
  const olderSignal = (getFiles.mock.calls[1][1] as { signal: AbortSignal }).signal;
  assert.equal(olderSignal.aborted, true);

  await act(async () => {
    newerRefetch.resolve(['a.txt', 'newer.txt']);
  });
  await waitFor(() => assert.deepEqual(shownNames(), ['a.txt', 'newer.txt']));

  await act(async () => {
    olderRefetch.resolve(['a.txt', 'older.txt']);
  });
  assert.deepEqual(shownNames(), ['a.txt', 'newer.txt']);
});

test('a refetch that lands after Escape dismissed the dropdown does not re-open it', async () => {
  getFiles.mockReset();
  getFiles.mockResolvedValueOnce(treeResponse(['a.txt']));
  const refetch = deferredTreeResponse();
  getFiles.mockReturnValueOnce(refetch.promise);
  getFiles.mockResolvedValue(treeResponse(['a.txt', 'new.txt']));

  const { result, type, shownNames } = renderMentions();
  await waitFor(() => assert.equal(getFiles.mock.calls.length, 1));

  type('mail me at foo@');
  await waitFor(() => assert.equal(getFiles.mock.calls.length, 2));
  assert.equal(result.current.showFileDropdown, true);

  act(() => {
    result.current.handleFileMentionsKeyDown(keyEvent('Escape'));
  });
  assert.equal(result.current.showFileDropdown, false);

  // Let the refetch, which brings a changed list, finish completely.
  await act(async () => {
    refetch.resolve(['a.txt', 'new.txt']);
    await new Promise((resolveTimeout) => setTimeout(resolveTimeout, 0));
  });

  // Still dismissed, so the next Enter reaches the composer and sends the message.
  assert.equal(result.current.showFileDropdown, false);
  let enterHandled = true;
  act(() => {
    enterHandled = result.current.handleFileMentionsKeyDown(keyEvent('Enter'));
  });
  assert.equal(enterHandled, false);
  assert.equal(getFiles.mock.calls.length, 2);

  // Typing on inside the query re-opens the dropdown, which fetches again.
  type('mail me at foo@ne');
  await waitFor(() => assert.deepEqual(shownNames(), ['new.txt']));
  assert.equal(getFiles.mock.calls.length, 3);
});
