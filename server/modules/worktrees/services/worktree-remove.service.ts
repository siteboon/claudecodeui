import { projectsDb } from '@/modules/database/index.js';
import { deleteOrArchiveProject } from '@/modules/projects/index.js';
import type { GitCommandRunner } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

import {
  countChangedFiles,
  findWorktreeEntryByPath,
  listWorktreePorcelainEntries,
  runGitCommand,
} from '@/modules/worktrees/services/worktree-git.service.js';

type RemoveWorktreeInput = {
  /** Absolute path of the requesting project (any worktree of the repo). */
  projectPath: string;
  /** Absolute path of the worktree to remove. */
  worktreePath: string;
  /** Remove even when the worktree has uncommitted changes. */
  force?: boolean;
  /** Also delete the worktree's branch after removal. */
  deleteBranch?: boolean;
};

export type RemoveWorktreeResult = {
  removedPath: string;
  branch: string | null;
  branchDeleted: boolean;
  archivedProjectId: string | null;
};

/**
 * Removes a linked worktree (never the main one), optionally deletes its
 * branch, and archives the CloudCLI project registered for the directory so it
 * disappears from the sidebar while its chat history stays recoverable.
 */
export async function removeWorktree(
  input: RemoveWorktreeInput,
  runGit: GitCommandRunner = runGitCommand,
): Promise<RemoveWorktreeResult> {
  const entries = await listWorktreePorcelainEntries(input.projectPath, runGit);
  const entry = findWorktreeEntryByPath(entries, input.worktreePath);
  const repositoryRoot = entries[0].path;

  if (entry.path === repositoryRoot) {
    throw new AppError('The main worktree cannot be removed', {
      code: 'WORKTREE_MAIN_NOT_REMOVABLE',
      statusCode: 400,
    });
  }

  if (!input.force) {
    const changedFileCount = await countChangedFiles(entry.path, runGit);
    if (changedFileCount > 0) {
      throw new AppError(
        `Worktree has ${changedFileCount} uncommitted change${changedFileCount === 1 ? '' : 's'}`,
        {
          code: 'WORKTREE_DIRTY',
          statusCode: 409,
        },
      );
    }
  }

  const removeArgs = ['worktree', 'remove'];
  if (input.force) {
    removeArgs.push('--force');
  }
  removeArgs.push(entry.path);
  await runGit(removeArgs, repositoryRoot);

  let branchDeleted = false;
  if (input.deleteBranch && entry.branch) {
    try {
      await runGit(['branch', '-D', entry.branch], repositoryRoot);
      branchDeleted = true;
    } catch {
      // Branch deletion is best-effort cleanup — the worktree itself is gone,
      // which is the operation the user asked for.
    }
  }

  let archivedProjectId: string | null = null;
  const linkedProject = projectsDb.getProjectPath(entry.path);
  if (linkedProject && !linkedProject.isArchived) {
    await deleteOrArchiveProject(linkedProject.project_id, false);
    archivedProjectId = linkedProject.project_id;
  }

  return {
    removedPath: entry.path,
    branch: entry.branch,
    branchDeleted,
    archivedProjectId,
  };
}
