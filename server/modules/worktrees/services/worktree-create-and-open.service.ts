import type {
  CreateAndOpenWorktreeResult,
  CreateWorktreeInput,
  CreateWorktreeResult,
  OpenWorktreeInput,
  RemoveWorktreeInput,
  RemoveWorktreeResult,
  WorktreeProjectView,
} from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

/**
 * Creates a Git worktree and registers it as a project for the Worktrees module.
 * Registration failure is compensated by removing only state created here.
 */
export async function createAndOpenWorktree(
  input: CreateWorktreeInput,
  dependencies: {
    createWorktree: (input: CreateWorktreeInput) => Promise<CreateWorktreeResult>;
    openWorktree: (input: OpenWorktreeInput) => Promise<WorktreeProjectView>;
    removeWorktree: (input: RemoveWorktreeInput) => Promise<RemoveWorktreeResult>;
  },
): Promise<CreateAndOpenWorktreeResult> {
  const created = await dependencies.createWorktree(input);

  try {
    const project = await dependencies.openWorktree({
      projectPath: input.projectPath,
      worktreePath: created.worktreePath,
    });
    return { ...created, project };
  } catch (openError) {
    try {
      await dependencies.removeWorktree({
        projectPath: input.projectPath,
        worktreePath: created.worktreePath,
        force: true,
        deleteBranch: created.createdBranch,
      });
    } catch (cleanupError) {
      throw new AppError('Worktree registration failed and its Git changes could not be rolled back', {
        code: 'WORKTREE_CREATE_ROLLBACK_FAILED',
        statusCode: 500,
        details: {
          registrationError: openError instanceof Error ? openError.message : String(openError),
          rollbackError: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
        },
      });
    }

    throw openError;
  }
}
