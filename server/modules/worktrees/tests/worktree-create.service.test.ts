import assert from 'node:assert/strict';
import test from 'node:test';

import { createWorktree } from '@/modules/worktrees/services/worktree-create.service.js';
import type { GitCommandResult } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

const PORCELAIN = [
  'worktree /home/user/repo',
  'HEAD 1111111111111111111111111111111111111111',
  'branch refs/heads/main',
  '',
  'worktree /home/user/repo-worktrees/existing',
  'HEAD 2222222222222222222222222222222222222222',
  'branch refs/heads/existing-branch',
  '',
].join('\n');

type RecordedCall = { args: string[]; cwd: string };

/**
 * Fake GitCommandRunner: records every call and answers `worktree list` /
 * `branch --list` from canned data; everything else succeeds with no output.
 */
function createFakeRunner(existingBranches: string[]) {
  const calls: RecordedCall[] = [];
  const runner = async (args: string[], cwd: string): Promise<GitCommandResult> => {
    calls.push({ args, cwd });

    if (args[0] === 'worktree' && args[1] === 'list') {
      return { stdout: PORCELAIN, stderr: '' };
    }

    if (args[0] === 'branch' && args[1] === '--list') {
      const requested = args[2];
      const matches = existingBranches.filter((branch) => branch === requested);
      return { stdout: matches.join('\n'), stderr: '' };
    }

    return { stdout: '', stderr: '' };
  };

  return { calls, runner };
}

function createDependencies(runner: ReturnType<typeof createFakeRunner>['runner'], pathExists = false) {
  return {
    runGit: runner,
    fileSystem: {
      pathExists: async () => pathExists,
    },
  };
}

test('createWorktree creates a new branch from the main branch by default', async () => {
  const { calls, runner } = createFakeRunner([]);

  const result = await createWorktree(
    { projectPath: '/home/user/repo', branch: 'feature/login' },
    createDependencies(runner),
  );

  assert.equal(result.branch, 'feature/login');
  assert.equal(result.createdBranch, true);
  // Slashes in the branch become dashes in the folder name.
  assert.ok(result.worktreePath.endsWith('feature-login'));
  assert.ok(result.worktreePath.includes('repo-worktrees'));

  const addCall = calls.find((call) => call.args[0] === 'worktree' && call.args[1] === 'add');
  assert.ok(addCall, 'expected a worktree add call');
  assert.deepEqual(addCall.args.slice(3), ['-b', 'feature/login', 'main']);
});

test('createWorktree checks out an existing branch without -b', async () => {
  const { calls, runner } = createFakeRunner(['bugfix']);

  const result = await createWorktree(
    { projectPath: '/home/user/repo', branch: 'bugfix' },
    createDependencies(runner),
  );

  assert.equal(result.createdBranch, false);

  const addCall = calls.find((call) => call.args[0] === 'worktree' && call.args[1] === 'add');
  assert.ok(addCall, 'expected a worktree add call');
  assert.ok(!addCall.args.includes('-b'));
  assert.equal(addCall.args.at(-1), 'bugfix');
});

test('createWorktree honors an explicit base branch', async () => {
  const { calls, runner } = createFakeRunner([]);

  await createWorktree(
    { projectPath: '/home/user/repo', branch: 'hotfix', baseBranch: 'release/1.0' },
    createDependencies(runner),
  );

  const addCall = calls.find((call) => call.args[0] === 'worktree' && call.args[1] === 'add');
  assert.ok(addCall);
  assert.equal(addCall.args.at(-1), 'release/1.0');
});

test('createWorktree rejects a branch already checked out in another worktree', async () => {
  const { runner } = createFakeRunner(['existing-branch']);

  await assert.rejects(
    createWorktree(
      { projectPath: '/home/user/repo', branch: 'existing-branch' },
      createDependencies(runner),
    ),
    (error: unknown) =>
      error instanceof AppError && error.code === 'BRANCH_ALREADY_CHECKED_OUT' && error.statusCode === 409,
  );
});

test('createWorktree rejects invalid branch names before touching git state', async () => {
  const { calls, runner } = createFakeRunner([]);

  await assert.rejects(
    createWorktree(
      { projectPath: '/home/user/repo', branch: '-rf' },
      createDependencies(runner),
    ),
    (error: unknown) => error instanceof AppError && error.code === 'INVALID_BRANCH_NAME',
  );

  assert.equal(calls.length, 0);
});

test('createWorktree rejects an occupied destination without running a mutating git command', async () => {
  const { calls, runner } = createFakeRunner([]);

  await assert.rejects(
    createWorktree(
      { projectPath: '/home/user/repo', branch: 'feature/login' },
      createDependencies(runner, true),
    ),
    (error: unknown) => error instanceof AppError && error.code === 'WORKTREE_FOLDER_EXISTS',
  );

  assert.equal(calls.some((call) => call.args[0] === 'worktree' && call.args[1] === 'add'), false);
});
