import assert from 'node:assert/strict';
import test from 'node:test';

import type { GitCommandResult } from '@/shared/types.js';

import { getBranchDiffForFile, listBranchDiffFiles } from '../git-branch-diff.service.js';

const MERGE_BASE = 'ad449053aa935934160725092c5ce8d63d336894';

// Joins NUL-separated tokens with a trailing NUL, exactly as `-z` output looks.
const nul = (...tokens: string[]) => tokens.join('\0') + '\0';

type FakeRunnerOptions = {
  nameStatus?: string;
  untracked?: string;
  diff?: string;
  failRevParse?: boolean;
  failMergeBase?: boolean;
};

/**
 * Fake `spawnAsync`: records every git invocation and answers the handful of
 * commands the service issues from canned output.
 */
function createRunner(options: FakeRunnerOptions = {}) {
  const calls: string[][] = [];
  const runCommand = async (_command: string, args: string[]): Promise<GitCommandResult> => {
    calls.push(args);
    const subcommand = args[0];

    if (subcommand === 'rev-parse') {
      if (options.failRevParse) {
        throw Object.assign(new Error('Command failed'), { stderr: '' });
      }
      return { stdout: `${MERGE_BASE}\n`, stderr: '' };
    }
    if (subcommand === 'merge-base') {
      if (options.failMergeBase) {
        throw Object.assign(new Error('Command failed'), { stderr: 'fatal: no merge base' });
      }
      return { stdout: `${MERGE_BASE}\n`, stderr: '' };
    }
    if (subcommand === 'diff') {
      return { stdout: args.includes('--name-status') ? options.nameStatus ?? '' : options.diff ?? '', stderr: '' };
    }
    if (subcommand === 'ls-files') {
      return { stdout: options.untracked ?? '', stderr: '' };
    }
    throw new Error(`Unexpected git command: ${args.join(' ')}`);
  };
  return { calls, runCommand };
}

test('listBranchDiffFiles verifies the ref before asking git for the merge base', async () => {
  const { calls, runCommand } = createRunner();

  const result = await listBranchDiffFiles({ projectPath: '/repo', base: 'origin/main', runCommand });

  assert.equal(result.mergeBase, MERGE_BASE);
  assert.deepEqual(calls.slice(0, 2), [
    ['rev-parse', '--verify', '--quiet', '--end-of-options', 'origin/main^{commit}'],
    ['merge-base', '--', 'origin/main', 'HEAD'],
  ]);
});

test('listBranchDiffFiles rejects a base that would be parsed as a git option without running git', async () => {
  const { calls, runCommand } = createRunner();

  await assert.rejects(
    listBranchDiffFiles({ projectPath: '/repo', base: '--output=/tmp/x', runCommand }),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, 'GIT_INVALID_BASE_REF');
      assert.equal((error as { statusCode?: number }).statusCode, 400);
      return true;
    },
  );
  assert.deepEqual(calls, []);
});

test('listBranchDiffFiles reports an unknown ref with a stable code', async () => {
  const { runCommand } = createRunner({ failRevParse: true });

  await assert.rejects(
    listBranchDiffFiles({ projectPath: '/repo', base: 'origin/nope', runCommand }),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, 'GIT_UNKNOWN_BASE_REF');
      assert.equal((error as { statusCode?: number }).statusCode, 400);
      return true;
    },
  );
});

test('getBranchDiffForFile reports branches without common history as a 400 AppError', async () => {
  const { runCommand } = createRunner({ failMergeBase: true });

  await assert.rejects(
    getBranchDiffForFile({ projectPath: '/repo', base: 'orphan', file: 'a.txt', runCommand, readFile: async () => '' }),
    (error: unknown) => {
      assert.equal((error as { name?: string }).name, 'AppError');
      assert.equal((error as { code?: string }).code, 'GIT_NO_MERGE_BASE');
      assert.equal((error as { statusCode?: number }).statusCode, 400);
      return true;
    },
  );
});

test('listBranchDiffFiles parses NUL-separated name-status output including renames', async () => {
  const { calls, runCommand } = createRunner({
    nameStatus: nul('M', 'src/a.txt', 'R100', 'old name.txt', 'new name.txt', 'A', 'b.txt', 'D', 'gone.txt', 'C75', 'base.txt', 'copy.txt'),
  });

  const result = await listBranchDiffFiles({ projectPath: '/repo', base: 'main', runCommand });

  assert.equal(result.base, 'main');
  assert.equal(result.mergeBase, MERGE_BASE);
  assert.deepEqual(result.files, [
    { path: 'b.txt', status: 'A' },
    { path: 'copy.txt', status: 'A' },
    { path: 'gone.txt', status: 'D' },
    { path: 'new name.txt', oldPath: 'old name.txt', status: 'R' },
    { path: 'src/a.txt', status: 'M' },
  ]);
  // The working tree is diffed against the merge base, never the base tip.
  assert.deepEqual(calls[2], ['diff', '--name-status', '-M', '-z', MERGE_BASE, '--']);
  assert.deepEqual(calls[3], ['ls-files', '--others', '--exclude-standard', '-z']);
});

test('listBranchDiffFiles merges untracked files as U and sorts everything by path', async () => {
  const { runCommand } = createRunner({
    nameStatus: nul('M', 'a.txt', 'A', 'b.txt'),
    untracked: nul('c.txt', 'aa.txt'),
  });

  const result = await listBranchDiffFiles({ projectPath: '/repo', base: 'main', runCommand });

  assert.deepEqual(result.files, [
    { path: 'a.txt', status: 'M' },
    { path: 'aa.txt', status: 'U' },
    { path: 'b.txt', status: 'A' },
    { path: 'c.txt', status: 'U' },
  ]);
});

test('listBranchDiffFiles returns an empty list when nothing differs', async () => {
  const { runCommand } = createRunner();

  const result = await listBranchDiffFiles({ projectPath: '/repo', base: 'main', runCommand });

  assert.deepEqual(result.files, []);
});

test('getBranchDiffForFile diffs a tracked file against the merge base with the path after --', async () => {
  const diff = 'diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1,2 +1,3 @@\n line1\n-line2\n+line2 changed\n+line3\n';
  const { calls, runCommand } = createRunner({ diff });
  let readFileCalls = 0;

  const result = await getBranchDiffForFile({
    projectPath: '/repo',
    base: 'main',
    file: 'a.txt',
    runCommand,
    readFile: async () => {
      readFileCalls += 1;
      return '';
    },
  });

  assert.equal(result, diff);
  assert.equal(readFileCalls, 0);
  assert.deepEqual(calls[2], ['ls-files', '--others', '--exclude-standard', '-z', '--', 'a.txt']);
  assert.deepEqual(calls[3], ['diff', '-M', MERGE_BASE, '--', 'a.txt']);
});

test('getBranchDiffForFile hands both paths of a rename to git so it diffs the rename, not a new file', async () => {
  const diff = 'diff --git a/keep.txt b/kept.txt\nsimilarity index 90%\nrename from keep.txt\nrename to kept.txt\n@@ -1 +1 @@\n-x\n+y\n';
  const { calls, runCommand } = createRunner({ diff });

  const result = await getBranchDiffForFile({
    projectPath: '/repo',
    base: 'main',
    file: 'kept.txt',
    oldPath: 'keep.txt',
    runCommand,
    readFile: async () => '',
  });

  assert.equal(result, diff);
  assert.deepEqual(calls[3], ['diff', '-M', MERGE_BASE, '--', 'keep.txt', 'kept.txt']);
});

test('getBranchDiffForFile synthesizes an all-additions diff for an untracked file', async () => {
  const { calls, runCommand } = createRunner({ untracked: nul('c.txt') });
  const readPaths: string[] = [];

  const result = await getBranchDiffForFile({
    projectPath: '/repo',
    base: 'main',
    file: 'c.txt',
    runCommand,
    readFile: async (absolutePath) => {
      readPaths.push(absolutePath);
      return 'first\nsecond';
    },
  });

  assert.deepEqual(readPaths, ['/repo/c.txt']);
  assert.equal(result, '--- /dev/null\n+++ b/c.txt\n@@ -0,0 +1,2 @@\n+first\n+second');
  // No `git diff` is run for untracked files.
  assert.equal(calls.some((args) => args[0] === 'diff'), false);
});
