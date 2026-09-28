import type { GitProcessRunner } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

type DeleteLocalBranchInput = {
  projectPath: string;
  branch: string;
  force: boolean;
  runCommand: GitProcessRunner;
};

/** Used by the Git routes module to safely delete a non-current local branch. */
export async function deleteLocalBranch(input: DeleteLocalBranchInput): Promise<string> {
  const { stdout: currentBranch } = await input.runCommand(
    'git',
    ['branch', '--show-current'],
    { cwd: input.projectPath },
  );

  if (currentBranch.trim() === input.branch) {
    throw new AppError('Cannot delete the currently checked-out branch', {
      code: 'GIT_CURRENT_BRANCH_DELETE',
      statusCode: 400,
    });
  }

  const deleteFlag = input.force ? '-D' : '-d';
  const { stdout } = await input.runCommand(
    'git',
    ['branch', deleteFlag, '--', input.branch],
    { cwd: input.projectPath },
  );
  return stdout;
}
