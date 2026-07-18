import type {
  GitCommandRunner,
  RemoveWorktreeInput,
  RemoveWorktreeResult,
  WorktreeProjectGateway,
} from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';
import {
  countChangedFiles,
  findWorktreeEntryByPath,
  listWorktreePorcelainEntries,
} from '@/modules/worktrees/services/worktree-git.service.js';

/**
 * Removes a linked worktree (never the main one), optionally deletes its
 * branch, and archives the CloudCLI project registered for the directory so it
 * disappears from the sidebar while its chat history stays recoverable.
 */
export async function removeWorktree(
  input: RemoveWorktreeInput,
  dependencies: {
    runGit: GitCommandRunner;
    projects: Pick<WorktreeProjectGateway, 'getProjectByPath' | 'archiveProject'>;
  },
): Promise<RemoveWorktreeResult> {
  const { projects, runGit } = dependencies;
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
  const linkedProject = projects.getProjectByPath(entry.path);
  if (linkedProject && !linkedProject.isArchived) {
    await projects.archiveProject(linkedProject.project_id);
    archivedProjectId = linkedProject.project_id;
  }

  return {
    removedPath: entry.path,
    branch: entry.branch,
    branchDeleted,
    archivedProjectId,
  };
}
