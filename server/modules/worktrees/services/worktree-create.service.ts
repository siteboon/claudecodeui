import path from 'node:path';

import type {
  CreateWorktreeInput,
  CreateWorktreeResult,
  GitCommandRunner,
  WorktreeFileSystem,
} from '@/shared/types.js';
import { AppError, normalizeProjectPath } from '@/shared/utils.js';
import {
  listWorktreePorcelainEntries,
  validateWorktreeBranchName,
} from '@/modules/worktrees/services/worktree-git.service.js';

/**
 * Turns a branch name into a filesystem-safe folder name:
 * "feature/login-form" → "feature-login-form".
 */
function sanitizeBranchForDirectoryName(branch: string): string {
  const sanitized = branch
    .replace(/[/\\:*?"<>|\s]+/g, '-')
    .replace(/\.+$/g, '')
    .replace(/^-+|-+$/g, '');

  if (!sanitized) {
    throw new AppError('Branch name cannot be converted to a folder name', {
      code: 'INVALID_WORKTREE_FOLDER_NAME',
      statusCode: 400,
    });
  }

  return sanitized;
}

/**
 * Creates a new worktree in a sibling folder of the repository:
 * `<repoParent>/<repoName>-worktrees/<branch>`. Existing local branches are
 * checked out directly; unknown branch names are created from `baseBranch`
 * (falling back to the main worktree's branch).
 */
export async function createWorktree(
  input: CreateWorktreeInput,
  dependencies: {
    runGit: GitCommandRunner;
    fileSystem: WorktreeFileSystem;
  },
): Promise<CreateWorktreeResult> {
  const { fileSystem, runGit } = dependencies;
  const branch = validateWorktreeBranchName(input.branch);

  const entries = await listWorktreePorcelainEntries(input.projectPath, runGit);
  const repositoryRoot = entries[0].path;

  const checkedOutElsewhere = entries.find((entry) => entry.branch === branch);
  if (checkedOutElsewhere) {
    throw new AppError(`Branch "${branch}" is already checked out in another worktree`, {
      code: 'BRANCH_ALREADY_CHECKED_OUT',
      statusCode: 409,
      details: checkedOutElsewhere.path,
    });
  }

  const worktreesContainer = path.join(
    path.dirname(repositoryRoot),
    `${path.basename(repositoryRoot)}-worktrees`,
  );
  const worktreePath = normalizeProjectPath(
    path.join(worktreesContainer, sanitizeBranchForDirectoryName(branch)),
  );

  if (await fileSystem.pathExists(worktreePath)) {
    throw new AppError(`Folder already exists: ${worktreePath}`, {
      code: 'WORKTREE_FOLDER_EXISTS',
      statusCode: 409,
    });
  }

  const { stdout: branchListOutput } = await runGit(
    ['branch', '--list', branch, '--format=%(refname:short)'],
    repositoryRoot,
  );
  const branchExists = branchListOutput
    .split('\n')
    .some((line) => line.trim() === branch);

  if (branchExists) {
    await runGit(['worktree', 'add', worktreePath, branch], repositoryRoot);
  } else {
    const baseBranch = input.baseBranch?.trim() || entries[0].branch;
    if (!baseBranch) {
      throw new AppError('Cannot determine a base branch (main worktree is detached)', {
        code: 'WORKTREE_BASE_BRANCH_UNKNOWN',
        statusCode: 400,
      });
    }

    await runGit(
      ['worktree', 'add', worktreePath, '-b', branch, validateWorktreeBranchName(baseBranch)],
      repositoryRoot,
    );
  }

  return { worktreePath, branch, createdBranch: !branchExists };
}
