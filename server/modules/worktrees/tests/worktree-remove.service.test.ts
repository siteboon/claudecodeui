import assert from 'node:assert/strict';
import test from 'node:test';

import { projectsDb } from '@/modules/database/index.js';
import { removeWorktree } from '@/modules/worktrees/services/worktree-remove.service.js';
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

function createFakeRunner(options: { dirty?: boolean; branchDeleteFails?: boolean } = {}) {
  const calls: RecordedCall[] = [];
  const runner = async (args: string[], cwd: string): Promise<GitCommandResult> => {
    calls.push({ args, cwd });

    if (args[0] === 'worktree' && args[1] === 'list') {
      return { stdout: PORCELAIN, stderr: '' };
    }

    if (args[0] === 'status') {
      return { stdout: options.dirty ? '?? new-file.txt\n' : '', stderr: '' };
    }

    if (args[0] === 'branch' && args[1] === '-D' && options.branchDeleteFails) {
      throw new AppError('branch delete failed', { code: 'GIT_COMMAND_FAILED' });
    }

    return { stdout: '', stderr: '' };
  };

  return { calls, runner };
}

/** Runs `callback` with `projectsDb.getProjectPath` stubbed to return no linked project. */
async function withNoLinkedProject(callback: () => Promise<void>): Promise<void> {
  const originalGetProjectPath = projectsDb.getProjectPath;
  try {
    projectsDb.getProjectPath = () => null;
    await callback();
  } finally {
    projectsDb.getProjectPath = originalGetProjectPath;
  }
}

test('removeWorktree removes a clean worktree and deletes its branch', async () => {
  await withNoLinkedProject(async () => {
    const { calls, runner } = createFakeRunner();

    const result = await removeWorktree(
      {
        projectPath: '/home/user/repo',
        worktreePath: '/home/user/repo-worktrees/feature-login',
        deleteBranch: true,
      },
      runner,
    );

    assert.equal(result.branch, 'feature/login');
    assert.equal(result.branchDeleted, true);
    assert.equal(result.archivedProjectId, null);

    const removeCall = calls.find((call) => call.args[0] === 'worktree' && call.args[1] === 'remove');
    assert.ok(removeCall, 'expected a worktree remove call');
    assert.ok(!removeCall.args.includes('--force'));

    const branchDeleteCall = calls.find((call) => call.args[0] === 'branch' && call.args[1] === '-D');
    assert.ok(branchDeleteCall, 'expected the branch to be deleted');
    assert.equal(branchDeleteCall.args[2], 'feature/login');
  });
});

test('removeWorktree rejects a dirty worktree unless forced', async () => {
  await withNoLinkedProject(async () => {
    const { runner } = createFakeRunner({ dirty: true });

    await assert.rejects(
      removeWorktree(
        {
          projectPath: '/home/user/repo',
          worktreePath: '/home/user/repo-worktrees/feature-login',
        },
        runner,
      ),
      (error: unknown) =>
        error instanceof AppError && error.code === 'WORKTREE_DIRTY' && error.statusCode === 409,
    );
  });
});

test('removeWorktree passes --force through and skips the dirty check', async () => {
  await withNoLinkedProject(async () => {
    const { calls, runner } = createFakeRunner({ dirty: true });

    await removeWorktree(
      {
        projectPath: '/home/user/repo',
        worktreePath: '/home/user/repo-worktrees/feature-login',
        force: true,
      },
      runner,
    );

    const removeCall = calls.find((call) => call.args[0] === 'worktree' && call.args[1] === 'remove');
    assert.ok(removeCall);
    assert.ok(removeCall.args.includes('--force'));
  });
});

test('removeWorktree reports branchDeleted=false when branch deletion fails', async () => {
  await withNoLinkedProject(async () => {
    const { runner } = createFakeRunner({ branchDeleteFails: true });

    const result = await removeWorktree(
      {
        projectPath: '/home/user/repo',
        worktreePath: '/home/user/repo-worktrees/feature-login',
        deleteBranch: true,
      },
      runner,
    );

    assert.equal(result.branchDeleted, false);
  });
});

test('removeWorktree never removes the main worktree', async () => {
  await withNoLinkedProject(async () => {
    const { runner } = createFakeRunner();

    await assert.rejects(
      removeWorktree(
        {
          projectPath: '/home/user/repo-worktrees/feature-login',
          worktreePath: '/home/user/repo',
        },
        runner,
      ),
      (error: unknown) =>
        error instanceof AppError && error.code === 'WORKTREE_MAIN_NOT_REMOVABLE' && error.statusCode === 400,
    );
  });
});
