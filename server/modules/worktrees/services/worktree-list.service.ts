import type {
  GitCommandRunner,
  ListWorktreesInput,
  ProjectRepositoryRow,
  WorktreeDescriptor,
  WorktreeListResult,
  WorktreePorcelainEntry,
} from '@/shared/types.js';
import { normalizeProjectPath } from '@/shared/utils.js';
import {
  countChangedFiles,
  listWorktreePorcelainEntries,
} from '@/modules/worktrees/services/worktree-git.service.js';

type ListWorktreesDependencies = {
  runGit: GitCommandRunner;
  getProjectByPath: (projectPath: string) => ProjectRepositoryRow | null;
};

const WORKTREE_LIST_CONCURRENCY = 4;

async function mapWithConcurrency<TInput, TOutput>(
  inputs: TInput[],
  concurrency: number,
  mapper: (input: TInput, index: number) => Promise<TOutput>,
): Promise<TOutput[]> {
  const results = new Array<TOutput>(inputs.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < inputs.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(inputs[index], index);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, inputs.length) }, () => worker()),
  );
  return results;
}

/**
 * Computes how many commits `branch` is ahead/behind `baseBranch`. Runs in the
 * main worktree so both refs are resolvable regardless of which worktree has
 * them checked out. Returns zeros when the comparison is impossible (same
 * branch, detached HEAD, unborn refs).
 */
async function countAheadBehind(
  repositoryRoot: string,
  baseBranch: string | null,
  branch: string | null,
  runGit: GitCommandRunner,
): Promise<{ ahead: number; behind: number }> {
  if (!baseBranch || !branch || baseBranch === branch) {
    return { ahead: 0, behind: 0 };
  }

  try {
    const { stdout } = await runGit(
      ['rev-list', '--left-right', '--count', `${baseBranch}...${branch}`],
      repositoryRoot,
    );
    const [behindRaw, aheadRaw] = stdout.trim().split(/\s+/);
    return {
      ahead: Number.parseInt(aheadRaw ?? '0', 10) || 0,
      behind: Number.parseInt(behindRaw ?? '0', 10) || 0,
    };
  } catch {
    return { ahead: 0, behind: 0 };
  }
}

/** Reads the last commit subject + ISO date of a worktree's HEAD (null on unborn branches). */
async function readLastCommit(
  worktreePath: string,
  runGit: GitCommandRunner,
): Promise<{ subject: string | null; date: string | null }> {
  try {
    const { stdout } = await runGit(['log', '-1', '--format=%s%x00%cI'], worktreePath);
    const [subject, date] = stdout.trim().split('\0');
    return { subject: subject || null, date: date || null };
  } catch {
    return { subject: null, date: null };
  }
}

/**
 * Builds the full Worktrees panel payload for the repository containing
 * `projectPath`: every worktree with dirty count, ahead/behind vs the base
 * branch, last commit info, and the linked CloudCLI project (when registered).
 */
export async function listWorktrees(
  input: ListWorktreesInput,
  dependencies: ListWorktreesDependencies,
): Promise<WorktreeListResult> {
  const { runGit, getProjectByPath } = dependencies;
  const entries = await listWorktreePorcelainEntries(input.projectPath, runGit);

  // The first porcelain entry is always the main worktree; its checked-out
  // branch is the merge target ("base branch") offered by the UI.
  const mainEntry = entries[0];
  const repositoryRoot = mainEntry.path;
  const baseBranch = mainEntry.branch;

  const requestedPath = normalizeProjectPath(input.projectPath);
  const comparable = (value: string) =>
    process.platform === 'win32' ? value.toLowerCase() : value;

  const worktrees = await mapWithConcurrency(
    entries,
    WORKTREE_LIST_CONCURRENCY,
    async (entry: WorktreePorcelainEntry, index: number): Promise<WorktreeDescriptor> => {
      const [changedFileCount, aheadBehind, lastCommit] = await Promise.all([
        countChangedFiles(entry.path, runGit),
        countAheadBehind(repositoryRoot, baseBranch, index === 0 ? null : entry.branch, runGit),
        readLastCommit(entry.path, runGit),
      ]);

      const linkedProject = getProjectByPath(entry.path);

      return {
        path: entry.path,
        branch: entry.branch,
        headSha: entry.headSha,
        isMain: index === 0,
        isCurrent: comparable(entry.path) === comparable(requestedPath),
        isLocked: entry.isLocked,
        isDetached: entry.isDetached,
        changedFileCount,
        ahead: aheadBehind.ahead,
        behind: aheadBehind.behind,
        lastCommitSubject: lastCommit.subject,
        lastCommitDate: lastCommit.date,
        linkedProjectId: linkedProject?.project_id ?? null,
        linkedProjectArchived: Boolean(linkedProject?.isArchived),
      };
    },
  );

  return { repositoryRoot, baseBranch, worktrees };
}
