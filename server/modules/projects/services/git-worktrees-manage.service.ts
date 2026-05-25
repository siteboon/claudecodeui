/**
 * Create + remove worktrees from the UI.
 *
 * Validation is strict on the name (one segment, no slashes, no shell-meta).
 * Worktrees are created at `<repoPath>/.worktrees/<name>` with a new branch
 * named the same as the directory. Existing branches reuse a checkout
 * instead of creating one.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

import { AppError } from '@/shared/utils.js';

type SpawnResult = { stdout: string; stderr: string; code: number };

function runGit(args: string[], cwd: string): Promise<SpawnResult> {
  return new Promise((resolve) => {
    const child = spawn('git', args, { cwd, shell: false });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', () => resolve({ stdout, stderr, code: 1 }));
    child.on('close', (code) => resolve({ stdout, stderr, code: code ?? 1 }));
  });
}

/** A safe worktree name: alphanumerics, dashes, underscores, dots, slashes. */
const VALID_NAME_REGEX = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

function validateName(name: string): void {
  if (!name || name.length === 0) {
    throw new AppError('Worktree name is required.', {
      code: 'WORKTREE_NAME_REQUIRED',
      statusCode: 400,
    });
  }
  if (name.length > 200) {
    throw new AppError('Worktree name is too long.', {
      code: 'WORKTREE_NAME_TOO_LONG',
      statusCode: 400,
    });
  }
  if (!VALID_NAME_REGEX.test(name)) {
    throw new AppError(
      'Invalid worktree name. Use letters, digits, "-", "_", "." and "/" only; must not start with a separator.',
      { code: 'WORKTREE_NAME_INVALID', statusCode: 400 },
    );
  }
  if (name.includes('..')) {
    throw new AppError('Worktree name cannot contain "..".', {
      code: 'WORKTREE_NAME_INVALID',
      statusCode: 400,
    });
  }
}

async function isInsideGitRepo(repoPath: string): Promise<boolean> {
  const result = await runGit(['rev-parse', '--is-inside-work-tree'], repoPath);
  return result.code === 0 && result.stdout.trim() === 'true';
}

async function branchExists(repoPath: string, branch: string): Promise<boolean> {
  const result = await runGit(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], repoPath);
  return result.code === 0;
}

export type CreatedWorktree = {
  path: string;
  branch: string;
  reusedExistingBranch: boolean;
};

export async function createWorktree(
  repoPath: string,
  name: string,
): Promise<CreatedWorktree> {
  if (!repoPath) {
    throw new AppError('Repository path is required.', {
      code: 'REPO_PATH_REQUIRED',
      statusCode: 400,
    });
  }
  validateName(name);

  if (!(await isInsideGitRepo(repoPath))) {
    throw new AppError('Project is not a git repository.', {
      code: 'NOT_A_GIT_REPO',
      statusCode: 400,
    });
  }

  const targetPath = path.join(repoPath, '.worktrees', name);
  if (existsSync(targetPath)) {
    throw new AppError(`A worktree already exists at ${targetPath}.`, {
      code: 'WORKTREE_PATH_EXISTS',
      statusCode: 409,
    });
  }

  const reuseExisting = await branchExists(repoPath, name);
  const args = reuseExisting
    ? ['worktree', 'add', targetPath, name]
    : ['worktree', 'add', '-b', name, targetPath];

  const result = await runGit(args, repoPath);
  if (result.code !== 0) {
    throw new AppError(
      `git worktree add failed: ${result.stderr.trim() || 'unknown error'}`,
      { code: 'WORKTREE_ADD_FAILED', statusCode: 500 },
    );
  }

  return { path: targetPath, branch: name, reusedExistingBranch: reuseExisting };
}

export async function removeWorktree(
  repoPath: string,
  worktreePath: string,
  options: { force?: boolean } = {},
): Promise<void> {
  if (!repoPath) {
    throw new AppError('Repository path is required.', {
      code: 'REPO_PATH_REQUIRED',
      statusCode: 400,
    });
  }
  if (!worktreePath) {
    throw new AppError('Worktree path is required.', {
      code: 'WORKTREE_PATH_REQUIRED',
      statusCode: 400,
    });
  }
  if (path.resolve(repoPath) === path.resolve(worktreePath)) {
    throw new AppError('Cannot remove the main worktree.', {
      code: 'CANNOT_REMOVE_MAIN_WORKTREE',
      statusCode: 400,
    });
  }
  if (!(await isInsideGitRepo(repoPath))) {
    throw new AppError('Project is not a git repository.', {
      code: 'NOT_A_GIT_REPO',
      statusCode: 400,
    });
  }

  const args = options.force
    ? ['worktree', 'remove', '--force', worktreePath]
    : ['worktree', 'remove', worktreePath];

  const result = await runGit(args, repoPath);
  if (result.code !== 0) {
    const stderr = result.stderr.trim();
    // Surface the "has changes" case so the UI can offer a force button.
    const isDirty = /contains modified or untracked files|locked working tree|is dirty/i.test(stderr);
    throw new AppError(
      `git worktree remove failed: ${stderr || 'unknown error'}`,
      {
        code: isDirty ? 'WORKTREE_DIRTY' : 'WORKTREE_REMOVE_FAILED',
        statusCode: isDirty ? 409 : 500,
      },
    );
  }
}
