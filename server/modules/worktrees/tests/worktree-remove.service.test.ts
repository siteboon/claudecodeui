import assert from 'node:assert/strict';
import test from 'node:test';

import { removeWorktree } from '@/modules/worktrees/services/worktree-remove.service.js';
import type { GitCommandResult, ProjectRepositoryRow } from '@/shared/types.js';
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

function createFakeRunner(options: {
  dirty?: boolean;
  branchDeleteFails?: boolean;
  statusFails?: boolean;
} = {}) {
  const calls: RecordedCall[] = [];
  const runner = async (args: string[], cwd: string): Promise<GitCommandResult> => {
    calls.push({ args, cwd });

    if (args[0] === 'worktree' && args[1] === 'list') {
      return { stdout: PORCELAIN, stderr: '' };
    }

    if (args[0] === 'status') {
      if (options.statusFails) {
        throw new AppError('status failed', { code: 'GIT_COMMAND_FAILED' });
      }
      return { stdout: options.dirty ? '?? new-file.txt\n' : '', stderr: '' };
    }

    if (args[0] === 'branch' && args[1] === '-D' && options.branchDeleteFails) {
      throw new AppError('branch delete failed', { code: 'GIT_COMMAND_FAILED' });
    }

    return { stdout: '', stderr: '' };
  };

  return { calls, runner };
}

function createDependencies(
  runner: ReturnType<typeof createFakeRunner>['runner'],
  linkedProject: ProjectRepositoryRow | null = null,
  archiveError: Error | null = null,
) {
  const archivedProjectIds: string[] = [];

  return {
    archivedProjectIds,
    dependencies: {
      runGit: runner,
      projects: {
        getProjectByPath: () => linkedProject,
        archiveProject: async (projectId: string) => {
          if (archiveError) {
            throw archiveError;
          }
          archivedProjectIds.push(projectId);
        },
      },
    },
  };
}

test('removeWorktree removes a clean worktree and deletes its branch', async () => {
  const { calls, runner } = createFakeRunner();
  const { dependencies } = createDependencies(runner);

  const result = await removeWorktree(
    {
      projectPath: '/home/user/repo',
      worktreePath: '/home/user/repo-worktrees/feature-login',
      deleteBranch: true,
    },
    dependencies,
  );

  assert.equal(result.branch, 'feature/login');
  assert.equal(result.branchDeleted, true);
  assert.equal(result.archivedProjectId, null);
  assert.equal(result.archivalError, null);

  const removeCall = calls.find((call) => call.args[0] === 'worktree' && call.args[1] === 'remove');
  assert.ok(removeCall, 'expected a worktree remove call');
  assert.ok(!removeCall.args.includes('--force'));

  const branchDeleteCall = calls.find((call) => call.args[0] === 'branch' && call.args[1] === '-D');
  assert.ok(branchDeleteCall, 'expected the branch to be deleted');
  assert.equal(branchDeleteCall.args[2], 'feature/login');
});

test('removeWorktree rejects a dirty worktree unless forced', async () => {
  const { runner } = createFakeRunner({ dirty: true });
  const { dependencies } = createDependencies(runner);

  await assert.rejects(
    removeWorktree(
      {
        projectPath: '/home/user/repo',
        worktreePath: '/home/user/repo-worktrees/feature-login',
      },
      dependencies,
    ),
    (error: unknown) =>
      error instanceof AppError && error.code === 'WORKTREE_DIRTY' && error.statusCode === 409,
  );
});

test('removeWorktree does not remove when status cannot confirm the worktree is clean', async () => {
  const { calls, runner } = createFakeRunner({ statusFails: true });
  const { dependencies } = createDependencies(runner);

  await assert.rejects(removeWorktree({
    projectPath: '/home/user/repo',
    worktreePath: '/home/user/repo-worktrees/feature-login',
  }, dependencies));

  assert.equal(calls.some((call) => call.args[0] === 'worktree' && call.args[1] === 'remove'), false);
});

test('removeWorktree passes --force through and skips the dirty check', async () => {
  const { calls, runner } = createFakeRunner({ dirty: true });
  const { dependencies } = createDependencies(runner);

  await removeWorktree(
    {
      projectPath: '/home/user/repo',
      worktreePath: '/home/user/repo-worktrees/feature-login',
      force: true,
    },
    dependencies,
  );

  const removeCall = calls.find((call) => call.args[0] === 'worktree' && call.args[1] === 'remove');
  assert.ok(removeCall);
  assert.ok(removeCall.args.includes('--force'));
});

test('removeWorktree reports branchDeleted=false when branch deletion fails', async () => {
  const { runner } = createFakeRunner({ branchDeleteFails: true });
  const { dependencies } = createDependencies(runner);

  const result = await removeWorktree(
    {
      projectPath: '/home/user/repo',
      worktreePath: '/home/user/repo-worktrees/feature-login',
      deleteBranch: true,
    },
    dependencies,
  );

  assert.equal(result.branchDeleted, false);
});

test('removeWorktree archives an active project linked to the removed path', async () => {
  const { runner } = createFakeRunner();
  const linkedProject: ProjectRepositoryRow = {
    project_id: 'project-1',
    project_path: '/home/user/repo-worktrees/feature-login',
    custom_project_name: 'repo · feature/login',
    isStarred: 0,
    isArchived: 0,
  };
  const { archivedProjectIds, dependencies } = createDependencies(runner, linkedProject);

  const result = await removeWorktree(
    {
      projectPath: '/home/user/repo',
      worktreePath: linkedProject.project_path,
    },
    dependencies,
  );

  assert.equal(result.archivedProjectId, 'project-1');
  assert.equal(result.archivalError, null);
  assert.deepEqual(archivedProjectIds, ['project-1']);
});

test('removeWorktree reports archival failure after successful Git removal', async () => {
  const { runner } = createFakeRunner();
  const linkedProject: ProjectRepositoryRow = {
    project_id: 'project-1',
    project_path: '/home/user/repo-worktrees/feature-login',
    custom_project_name: 'feature/login',
    isStarred: 0,
    isArchived: 0,
  };
  const { dependencies } = createDependencies(runner, linkedProject, new Error('archive failed'));

  const result = await removeWorktree({
    projectPath: '/home/user/repo',
    worktreePath: linkedProject.project_path,
  }, dependencies);

  assert.equal(result.removedPath.replace(/\\/g, '/'), linkedProject.project_path);
  assert.equal(result.archivedProjectId, null);
  assert.equal(result.archivalError, 'archive failed');
});

test('removeWorktree never removes the main worktree', async () => {
  const { runner } = createFakeRunner();
  const { dependencies } = createDependencies(runner);

  await assert.rejects(
    removeWorktree(
      {
        projectPath: '/home/user/repo-worktrees/feature-login',
        worktreePath: '/home/user/repo',
      },
      dependencies,
    ),
    (error: unknown) =>
      error instanceof AppError
      && error.code === 'WORKTREE_MAIN_NOT_REMOVABLE'
      && error.statusCode === 400,
  );
});
