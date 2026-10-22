import assert from 'node:assert/strict';

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import type { GitBranchDiffResponse, GitFileDiffResponse, GitStatusResponse } from '@/shared/types';

/**
 * The Compare tab's data hook. These cover the request lifecycle rather than
 * rendering: a base change issues a new request, a response for a superseded
 * base is dropped, and server-side failures surface as an error state with
 * their stable code.
 */

type Deferred = {
  resolve: (payload: GitBranchDiffResponse) => void;
};

const branchDiffCalls: { base: string; signal?: AbortSignal }[] = [];
const pendingBranchDiffs: Deferred[] = [];
const branchDiffFileCalls: { base: string; filePath: string; oldPath?: string }[] = [];
// Per-path canned answers for the file diff endpoint; unlisted paths get a plain diff.
const branchDiffFileResponses: Record<string, GitFileDiffResponse> = {};

vi.mock('@/shared/api', () => ({
  api: {
    git: {
      branchDiff: (_projectId: string, base: string, options: { signal?: AbortSignal } = {}) => {
        branchDiffCalls.push({ base, signal: options.signal });
        return new Promise<{ json: () => Promise<GitBranchDiffResponse> }>((resolve) => {
          pendingBranchDiffs.push({
            resolve: (payload) => resolve({ json: async () => payload }),
          });
        });
      },
      branchDiffFile: (_projectId: string, base: string, filePath: string, oldPath?: string) => {
        branchDiffFileCalls.push({ base, filePath, oldPath });
        const payload = branchDiffFileResponses[filePath] ?? { diff: `@@ diff of ${filePath} vs ${base} @@` };
        return Promise.resolve({ json: async () => payload });
      },
    },
  },
}));

const renderCompare = async (
  initial: { localBranches?: string[]; remoteRefs?: string[]; gitStatus?: GitStatusResponse | null } = {},
) => {
  const { useBranchCompare } = await import('@/modules/git-panel/hooks/useBranchCompare');

  return renderHook(
    ({ localBranches, remoteRefs, gitStatus }: {
      localBranches: string[];
      remoteRefs: string[];
      gitStatus: GitStatusResponse | null;
    }) =>
      useBranchCompare({
        projectId: 'project-1',
        currentBranch: 'feature',
        localBranches,
        remoteRefs,
        gitStatus,
      }),
    {
      initialProps: {
        localBranches: initial.localBranches ?? ['feature', 'main'],
        remoteRefs: initial.remoteRefs ?? ['origin/main'],
        gitStatus: initial.gitStatus ?? null,
      },
    },
  );
};

const respond = (index: number, payload: GitBranchDiffResponse) => {
  act(() => {
    pendingBranchDiffs[index].resolve(payload);
  });
};

beforeEach(() => {
  branchDiffCalls.length = 0;
  pendingBranchDiffs.length = 0;
  branchDiffFileCalls.length = 0;
  for (const key of Object.keys(branchDiffFileResponses)) {
    delete branchDiffFileResponses[key];
  }
});

afterEach(() => {
  vi.resetModules();
});

test('loads the default base on mount and re-fetches when the base changes', async () => {
  const { result } = await renderCompare();

  assert.equal(result.current.base, 'main');
  assert.equal(result.current.isLoading, true);
  assert.deepEqual(branchDiffCalls.map((call) => call.base), ['main']);

  respond(0, { base: 'main', mergeBase: 'abc1234def', files: [{ path: 'a.txt', status: 'M' }] });
  await waitFor(() => assert.equal(result.current.isLoading, false));
  assert.deepEqual(result.current.files, [{ path: 'a.txt', status: 'M' }]);
  assert.equal(result.current.mergeBase, 'abc1234def');

  act(() => {
    result.current.setBase('origin/main');
  });

  assert.equal(result.current.base, 'origin/main');
  assert.deepEqual(branchDiffCalls.map((call) => call.base), ['main', 'origin/main']);
  // The previous base's request is abandoned and its list cleared while the new one loads.
  assert.equal(branchDiffCalls[0].signal?.aborted, true);
  assert.deepEqual(result.current.files, []);

  respond(1, { base: 'origin/main', mergeBase: 'fff0000', files: [{ path: 'b.txt', status: 'A' }] });
  await waitFor(() => assert.deepEqual(result.current.files, [{ path: 'b.txt', status: 'A' }]));
});

test('ignores a response that arrives after the base has moved on', async () => {
  const { result } = await renderCompare();

  act(() => {
    result.current.setBase('origin/main');
  });
  assert.equal(pendingBranchDiffs.length, 2);

  // The stale (first) response resolves late, after the base changed.
  respond(0, { base: 'main', mergeBase: 'stale', files: [{ path: 'stale.txt', status: 'M' }] });
  respond(1, { base: 'origin/main', mergeBase: 'fresh', files: [{ path: 'fresh.txt', status: 'M' }] });

  await waitFor(() => assert.equal(result.current.isLoading, false));
  assert.equal(result.current.mergeBase, 'fresh');
  assert.deepEqual(result.current.files, [{ path: 'fresh.txt', status: 'M' }]);
});

test('surfaces a server error with its stable code and clears it on the next success', async () => {
  const { result } = await renderCompare();

  respond(0, { error: '"main" and the current branch share no common history', code: 'GIT_NO_MERGE_BASE' });
  await waitFor(() => assert.notEqual(result.current.error, null));
  assert.equal(result.current.error?.code, 'GIT_NO_MERGE_BASE');
  assert.deepEqual(result.current.files, []);
  assert.equal(result.current.isLoading, false);

  act(() => {
    result.current.refresh();
  });
  assert.equal(pendingBranchDiffs.length, 2);
  respond(1, { base: 'main', mergeBase: 'abc', files: [] });
  await waitFor(() => assert.equal(result.current.error, null));
});

test('waits for the branch lists before choosing a base', async () => {
  const { result, rerender } = await renderCompare({ localBranches: [], remoteRefs: [] });

  // `currentBranch` is "feature" but nothing else is known yet — no request.
  assert.equal(result.current.base, '');
  assert.equal(result.current.isLoading, false);
  assert.equal(branchDiffCalls.length, 0);

  rerender({ localBranches: ['feature', 'main'], remoteRefs: [], gitStatus: null });
  assert.equal(result.current.base, 'main');
  assert.deepEqual(branchDiffCalls.map((call) => call.base), ['main']);
});

test('re-runs the comparison when the working-tree status changes and keeps loaded diffs fresh', async () => {
  const { result, rerender } = await renderCompare();

  respond(0, { base: 'main', mergeBase: 'abc', files: [{ path: 'a.txt', status: 'M' }, { path: 'c.txt', status: 'U' }] });
  await waitFor(() => assert.equal(result.current.files.length, 2));

  await act(async () => {
    await result.current.loadFileDiff({ path: 'a.txt', status: 'M' });
  });
  assert.equal(result.current.fileDiffs['a.txt'], '@@ diff of a.txt vs main @@');
  assert.deepEqual(branchDiffFileCalls, [{ base: 'main', filePath: 'a.txt', oldPath: undefined }]);

  rerender({ localBranches: ['feature', 'main'], remoteRefs: ['origin/main'], gitStatus: { branch: 'feature', modified: ['a.txt'] } });
  assert.equal(branchDiffCalls.length, 2);
  // Same base: the current list stays on screen while the refresh is in flight.
  assert.equal(result.current.files.length, 2);

  respond(1, { base: 'main', mergeBase: 'abc', files: [{ path: 'a.txt', status: 'M' }] });
  await waitFor(() => assert.equal(result.current.files.length, 1));
  // The open diff was reloaded rather than dropped.
  await waitFor(() => assert.equal(branchDiffFileCalls.length, 2));
  assert.equal(result.current.fileDiffs['a.txt'], '@@ diff of a.txt vs main @@');
});

test('records a failed file diff load so the row can show it, and clears it on a successful retry', async () => {
  const { result } = await renderCompare();

  respond(0, { base: 'main', mergeBase: 'abc', files: [{ path: 'a.txt', status: 'M' }] });
  await waitFor(() => assert.equal(result.current.files.length, 1));

  branchDiffFileResponses['a.txt'] = { error: 'Git operation failed', details: 'fatal: bad object' };
  await act(async () => {
    await result.current.loadFileDiff({ path: 'a.txt', status: 'M' });
  });
  assert.equal(result.current.fileDiffs['a.txt'], undefined);
  assert.equal(result.current.fileDiffErrors['a.txt'], 'fatal: bad object');

  delete branchDiffFileResponses['a.txt'];
  await act(async () => {
    await result.current.loadFileDiff({ path: 'a.txt', status: 'M' });
  });
  assert.equal(result.current.fileDiffErrors['a.txt'], undefined);
  assert.equal(result.current.fileDiffs['a.txt'], '@@ diff of a.txt vs main @@');
});

test('forwards the pre-rename path so the server diffs the rename rather than a new file', async () => {
  const { result } = await renderCompare();

  respond(0, { base: 'main', mergeBase: 'abc', files: [{ path: 'kept.txt', oldPath: 'keep.txt', status: 'R' }] });
  await waitFor(() => assert.equal(result.current.files.length, 1));

  await act(async () => {
    await result.current.loadFileDiff({ path: 'kept.txt', oldPath: 'keep.txt', status: 'R' });
  });
  assert.deepEqual(branchDiffFileCalls, [{ base: 'main', filePath: 'kept.txt', oldPath: 'keep.txt' }]);
});

test('drops a chosen base that no longer exists and falls back to the default', async () => {
  const { result, rerender } = await renderCompare({ localBranches: ['feature', 'main', 'topic'] });

  act(() => {
    result.current.setBase('topic');
  });
  assert.equal(result.current.base, 'topic');

  rerender({ localBranches: ['feature', 'main'], remoteRefs: ['origin/main'], gitStatus: null });
  assert.equal(result.current.base, 'main');
});
