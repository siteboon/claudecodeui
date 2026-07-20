import assert from 'node:assert/strict';
import test from 'node:test';

import { mergeWorktree } from '@/modules/worktrees/services/worktree-merge.service.js';
import type { GitCommandResult } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

const PORCELAIN = [
  'worktree /home/user/repo',
  'HEAD 1111111111111111111111111111111111111111',
  'branch refs/heads/main',
  '',
  'worktree /home/user/repo-worktrees/feature-login',
  'HEAD 2222222222222222222222222222222222222222',
  'branch refs/heads/feature/login',
  '',
].join('\n');

type RecordedCall = { args: string[]; cwd: string };

type FakeRunnerOptions = {
  /** Worktree paths whose `git status --porcelain` should report dirty files. */
  dirtyPaths?: string[];
  /** When true, `git merge` fails and reports one conflicted file. */
  mergeConflicts?: boolean;
  rollbackFails?: boolean;
};

function createFakeRunner(options: FakeRunnerOptions = {}) {
  const calls: RecordedCall[] = [];
  const runner = async (args: string[], cwd: string): Promise<GitCommandResult> => {
    calls.push({ args, cwd });

    if (args[0] === 'worktree' && args[1] === 'list') {
      return { stdout: PORCELAIN, stderr: '' };
    }

    if (args[0] === 'status') {
      const isDirty = (options.dirtyPaths ?? []).some((dirtyPath) => cwd.includes(dirtyPath));
      return { stdout: isDirty ? ' M file.txt\n' : '', stderr: '' };
    }

    if (args[0] === 'merge' && options.mergeConflicts) {
      throw new AppError('git merge failed', {
        code: 'GIT_COMMAND_FAILED',
        details: 'CONFLICT (content): Merge conflict in file.txt',
      });
    }

    if (args[0] === 'diff' && args.includes('--diff-filter=U')) {
      return { stdout: options.mergeConflicts ? 'file.txt\n' : '', stderr: '' };
    }

    if (args[0] === 'reset' && options.rollbackFails) {
      throw new AppError('git reset failed', {
        code: 'GIT_COMMAND_FAILED',
        details: 'index.lock permission denied',
      });
    }

    return { stdout: '', stderr: '' };
  };

  return { calls, runner };
}

function createDependencies(runner: ReturnType<typeof createFakeRunner>['runner']) {
  return {
    runGit: runner,
    removeWorktree: async () => {
      throw new Error('removeWorktree should not be called by this test');
    },
  };
}

test('mergeWorktree squash-merges into the main worktree branch', async () => {
  const { calls, runner } = createFakeRunner();

  const result = await mergeWorktree(
    {
      projectPath: '/home/user/repo-worktrees/feature-login',
      worktreePath: '/home/user/repo-worktrees/feature-login',
      squash: true,
    },
    createDependencies(runner),
  );

  assert.equal(result.mergedBranch, 'feature/login');
  assert.equal(result.targetBranch, 'main');
  assert.equal(result.squash, true);
  assert.equal(result.removedWorktree, null);
  assert.equal(result.cleanupError, null);

  const mergeCall = calls.find((call) => call.args[0] === 'merge');
  assert.ok(mergeCall, 'expected a merge call');
  assert.deepEqual(mergeCall.args, ['merge', '--squash', 'feature/login']);
  // Squash merges run in the main worktree, never in the source worktree.
  assert.ok(mergeCall.cwd.endsWith('repo'));

  const commitCall = calls.find((call) => call.args[0] === 'commit');
  assert.ok(commitCall, 'expected a commit call after squash');
  assert.equal(commitCall.args[2], "Squash merge branch 'feature/login'");
});

test('mergeWorktree performs a regular --no-ff merge with a custom message', async () => {
  const { calls, runner } = createFakeRunner();

  await mergeWorktree(
    {
      projectPath: '/home/user/repo',
      worktreePath: '/home/user/repo-worktrees/feature-login',
      squash: false,
      message: 'Land the login feature',
    },
    createDependencies(runner),
  );

  const mergeCall = calls.find((call) => call.args[0] === 'merge');
  assert.ok(mergeCall);
  assert.deepEqual(mergeCall.args, ['merge', '--no-ff', 'feature/login', '-m', 'Land the login feature']);
});

test('mergeWorktree rejects when the source worktree is dirty', async () => {
  const { runner } = createFakeRunner({ dirtyPaths: ['feature-login'] });

  await assert.rejects(
    mergeWorktree(
      {
        projectPath: '/home/user/repo',
        worktreePath: '/home/user/repo-worktrees/feature-login',
      },
      createDependencies(runner),
    ),
    (error: unknown) =>
      error instanceof AppError && error.code === 'WORKTREE_SOURCE_DIRTY' && error.statusCode === 409,
  );
});

test('mergeWorktree aborts and reports conflicted files on merge conflict', async () => {
  const { calls, runner } = createFakeRunner({ mergeConflicts: true });

  await assert.rejects(
    mergeWorktree(
      {
        projectPath: '/home/user/repo',
        worktreePath: '/home/user/repo-worktrees/feature-login',
      },
      createDependencies(runner),
    ),
    (error: unknown) =>
      error instanceof AppError &&
      error.code === 'WORKTREE_MERGE_CONFLICT' &&
      error.statusCode === 409 &&
      Array.isArray(error.details) &&
      error.details.includes('file.txt'),
  );

  const resetCall = calls.find((call) => call.args[0] === 'reset');
  assert.ok(resetCall, 'expected the merge to be rolled back');
  assert.deepEqual(resetCall.args, ['reset', '--merge']);
});

test('mergeWorktree reports rollback failure instead of claiming a conflict was aborted', async () => {
  const { runner } = createFakeRunner({ mergeConflicts: true, rollbackFails: true });

  await assert.rejects(
    mergeWorktree(
      {
        projectPath: '/home/user/repo',
        worktreePath: '/home/user/repo-worktrees/feature-login',
      },
      createDependencies(runner),
    ),
    (error: unknown) =>
      error instanceof AppError
      && error.code === 'WORKTREE_MERGE_ROLLBACK_FAILED'
      && typeof error.details === 'object',
  );
});

test('mergeWorktree preserves merge success when optional worktree cleanup fails', async () => {
  const { runner } = createFakeRunner();
  const result = await mergeWorktree(
    {
      projectPath: '/home/user/repo',
      worktreePath: '/home/user/repo-worktrees/feature-login',
      removeAfterMerge: true,
    },
    {
      runGit: runner,
      removeWorktree: async () => { throw new Error('cleanup unavailable'); },
    },
  );

  assert.equal(result.mergedBranch, 'feature/login');
  assert.equal(result.removedWorktree, null);
  assert.equal(result.cleanupError, 'cleanup unavailable');
});

test('mergeWorktree refuses to merge the main worktree into itself', async () => {
  const { runner } = createFakeRunner();

  await assert.rejects(
    mergeWorktree(
      {
        projectPath: '/home/user/repo',
        worktreePath: '/home/user/repo',
      },
      createDependencies(runner),
    ),
    (error: unknown) => error instanceof AppError && error.code === 'WORKTREE_MERGE_MAIN',
  );
});
