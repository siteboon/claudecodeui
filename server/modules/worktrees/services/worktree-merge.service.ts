import type {
  GitCommandRunner,
  MergeWorktreeInput,
  MergeWorktreeResult,
  RemoveWorktreeInput,
  RemoveWorktreeResult,
} from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';
import {
  countChangedFiles,
  findWorktreeEntryByPath,
  listWorktreePorcelainEntries,
} from '@/modules/worktrees/services/worktree-git.service.js';

/** Reads the paths currently in conflict inside the main worktree (best effort). */
async function readConflictedFiles(repositoryRoot: string, runGit: GitCommandRunner): Promise<string[]> {
  try {
    const { stdout } = await runGit(['diff', '--name-only', '--diff-filter=U'], repositoryRoot);
    return stdout.split('\n').filter((line) => line.trim().length > 0);
  } catch {
    return [];
  }
}

/**
 * Merges a worktree's branch back into the base branch (the branch checked out
 * in the main worktree). Runs entirely inside the main worktree, so the user's
 * current worktree never changes underneath them.
 *
 * Both worktrees must be clean: the source so no work is silently left behind,
 * the target so a conflict can be rolled back without touching user changes.
 * On conflict the merge is fully aborted and the conflicting paths are
 * reported back to the client.
 */
export async function mergeWorktree(
  input: MergeWorktreeInput,
  dependencies: {
    runGit: GitCommandRunner;
    removeWorktree: (input: RemoveWorktreeInput) => Promise<RemoveWorktreeResult>;
  },
): Promise<MergeWorktreeResult> {
  const { removeWorktree, runGit } = dependencies;
  const entries = await listWorktreePorcelainEntries(input.projectPath, runGit);
  const entry = findWorktreeEntryByPath(entries, input.worktreePath);
  const repositoryRoot = entries[0].path;
  const targetBranch = entries[0].branch;

  if (entry.path === repositoryRoot) {
    throw new AppError('The main worktree cannot be merged into itself', {
      code: 'WORKTREE_MERGE_MAIN',
      statusCode: 400,
    });
  }

  if (!entry.branch) {
    throw new AppError('Worktree is on a detached HEAD — check out a branch first', {
      code: 'WORKTREE_DETACHED_HEAD',
      statusCode: 400,
    });
  }

  if (!targetBranch) {
    throw new AppError('The main worktree is on a detached HEAD — cannot determine merge target', {
      code: 'WORKTREE_TARGET_DETACHED',
      statusCode: 400,
    });
  }

  const sourceChangedCount = await countChangedFiles(entry.path, runGit);
  if (sourceChangedCount > 0) {
    throw new AppError(
      `Worktree has ${sourceChangedCount} uncommitted change${sourceChangedCount === 1 ? '' : 's'} — commit or discard them first`,
      { code: 'WORKTREE_SOURCE_DIRTY', statusCode: 409 },
    );
  }

  const targetChangedCount = await countChangedFiles(repositoryRoot, runGit);
  if (targetChangedCount > 0) {
    throw new AppError(
      `The base worktree (${targetBranch}) has uncommitted changes — commit or stash them first`,
      { code: 'WORKTREE_TARGET_DIRTY', statusCode: 409 },
    );
  }

  const squash = Boolean(input.squash);
  const message =
    input.message?.trim() ||
    (squash ? `Squash merge branch '${entry.branch}'` : `Merge branch '${entry.branch}'`);

  try {
    if (squash) {
      await runGit(['merge', '--squash', entry.branch], repositoryRoot);
      await runGit(['commit', '-m', message], repositoryRoot);
    } else {
      await runGit(['merge', '--no-ff', entry.branch, '-m', message], repositoryRoot);
    }
  } catch (error) {
    const conflictedFiles = await readConflictedFiles(repositoryRoot, runGit);
    // Roll the main worktree back to its pre-merge state. `--merge` also
    // clears a half-applied squash since the target was verified clean above.
    try {
      await runGit(['reset', '--merge'], repositoryRoot);
    } catch (rollbackError) {
      throw new AppError(
        `Merge of '${entry.branch}' into '${targetBranch}' failed and could not be rolled back`,
        {
          code: 'WORKTREE_MERGE_ROLLBACK_FAILED',
          statusCode: 500,
          details: {
            mergeError: error instanceof Error ? error.message : String(error),
            rollbackError: rollbackError instanceof AppError
              ? rollbackError.details ?? rollbackError.message
              : rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
          },
        },
      );
    }

    if (conflictedFiles.length > 0) {
      throw new AppError(
        `Merge of '${entry.branch}' into '${targetBranch}' has conflicts — the merge was aborted`,
        {
          code: 'WORKTREE_MERGE_CONFLICT',
          statusCode: 409,
          details: conflictedFiles,
        },
      );
    }

    throw error;
  }

  let removedWorktree: RemoveWorktreeResult | null = null;
  let cleanupError: string | null = null;
  if (input.removeAfterMerge) {
    try {
      removedWorktree = await removeWorktree(
        {
          projectPath: repositoryRoot,
          worktreePath: entry.path,
          force: false,
          deleteBranch: true,
        },
      );
    } catch (error) {
      cleanupError = error instanceof Error ? error.message : String(error);
    }
  }

  return {
    mergedBranch: entry.branch,
    targetBranch,
    squash,
    removedWorktree,
    cleanupError,
  };
}
