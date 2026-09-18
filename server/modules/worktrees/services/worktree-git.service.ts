// cross-spawn: drop-in spawn with Windows .cmd/PATHEXT resolution (same choice as routes/git.js).
import spawn from 'cross-spawn';

import type { GitCommandResult, GitCommandRunner, WorktreePorcelainEntry } from '@/shared/types.js';
import { AppError, normalizeProjectPath } from '@/shared/utils.js';

/**
 * Default `GitCommandRunner`: spawns `git <args>` in `cwd` and captures output.
 * Rejects with an `AppError` carrying git's stderr when the command fails, so
 * callers (and ultimately the API client) see the real git diagnostic.
 */
export function runGitCommand(args: string[], cwd: string): Promise<GitCommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd, shell: false });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    child.on('error', (error) => {
      reject(
        new AppError(`Failed to run git: ${error.message}`, {
          code: 'GIT_SPAWN_FAILED',
          statusCode: 500,
        }),
      );
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(
        new AppError(`git ${args.join(' ')} failed`, {
          code: 'GIT_COMMAND_FAILED',
          statusCode: 500,
          details: (stderr || stdout).trim(),
        }),
      );
    });
  });
}

/**
 * Defense-in-depth branch-name validation (mirrors routes/git.js), tightened to
 * also reject the leading-dash / lone-dot forms git itself refuses.
 */
export function validateWorktreeBranchName(branch: string): string {
  const trimmed = branch.trim();
  const components = trimmed.split('/');
  if (
    !trimmed ||
    trimmed.startsWith('-') ||
    trimmed.startsWith('/') ||
    trimmed.endsWith('/') ||
    trimmed.endsWith('.') ||
    trimmed === '.' ||
    trimmed === '..' ||
    trimmed.includes('..') ||
    trimmed.includes('//') ||
    components.some((component) =>
      component.startsWith('.') || component.toLowerCase().endsWith('.lock')) ||
    !/^[a-zA-Z0-9._/-]+$/.test(trimmed)
  ) {
    throw new AppError('Invalid branch name', {
      code: 'INVALID_BRANCH_NAME',
      statusCode: 400,
    });
  }
  return trimmed;
}

/**
 * Parses `git worktree list --porcelain` output. Entries are separated by blank
 * lines; the first entry is always the main worktree. Paths come back with
 * forward slashes even on Windows, so they are normalized here for stable
 * comparisons against DB-stored project paths.
 */
export function parseWorktreeListPorcelain(output: string): WorktreePorcelainEntry[] {
  const entries: WorktreePorcelainEntry[] = [];
  let current: WorktreePorcelainEntry | null = null;

  const flush = () => {
    if (current) {
      entries.push(current);
      current = null;
    }
  };

  for (const rawLine of output.split('\n')) {
    const line = rawLine.trimEnd();
    if (!line) {
      flush();
      continue;
    }

    if (line.startsWith('worktree ')) {
      flush();
      current = {
        path: normalizeProjectPath(line.slice('worktree '.length)),
        headSha: null,
        branch: null,
        isDetached: false,
        isLocked: false,
        isPrunable: false,
      };
      continue;
    }

    if (!current) {
      continue;
    }

    if (line.startsWith('HEAD ')) {
      current.headSha = line.slice('HEAD '.length).trim() || null;
    } else if (line.startsWith('branch ')) {
      // Porcelain reports the full ref, e.g. "branch refs/heads/feature/x".
      current.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '').trim() || null;
    } else if (line === 'detached') {
      current.isDetached = true;
    } else if (line === 'locked' || line.startsWith('locked ')) {
      current.isLocked = true;
    } else if (line === 'prunable' || line.startsWith('prunable ')) {
      current.isPrunable = true;
    }
  }

  flush();
  return entries;
}

/**
 * Lists the repository's worktrees (main worktree first) for the repo that
 * contains `projectPath`. Throws a 400 `AppError` when the directory is not
 * inside a git repository.
 */
export async function listWorktreePorcelainEntries(
  projectPath: string,
  runGit: GitCommandRunner,
): Promise<WorktreePorcelainEntry[]> {
  let output: string;
  try {
    const result = await runGit(['worktree', 'list', '--porcelain'], projectPath);
    output = result.stdout;
  } catch (error) {
    throw new AppError('Not a git repository', {
      code: 'NOT_A_GIT_REPOSITORY',
      statusCode: 400,
      details: error instanceof AppError ? error.details : String(error),
    });
  }

  const entries = parseWorktreeListPorcelain(output);
  if (entries.length === 0) {
    throw new AppError('No worktrees found for repository', {
      code: 'WORKTREE_LIST_EMPTY',
      statusCode: 500,
    });
  }

  return entries;
}

/**
 * Finds the worktree entry matching `worktreePath` (normalized comparison).
 * Throws a 404 `AppError` when the path is not a registered worktree of the
 * repository — this is the guard that stops arbitrary paths reaching git.
 */
export function findWorktreeEntryByPath(
  entries: WorktreePorcelainEntry[],
  worktreePath: string,
): WorktreePorcelainEntry {
  const normalized = normalizeProjectPath(worktreePath);
  const comparable = (value: string) =>
    process.platform === 'win32' ? value.toLowerCase() : value;

  const match = entries.find((entry) => comparable(entry.path) === comparable(normalized));
  if (!match) {
    throw new AppError('Path is not a worktree of this repository', {
      code: 'WORKTREE_NOT_FOUND',
      statusCode: 404,
    });
  }

  return match;
}

/**
 * Counts dirty paths (`git status --porcelain`) inside one worktree. Status
 * failures propagate so callers never mistake an unreadable worktree for clean.
 */
export async function countChangedFiles(
  worktreePath: string,
  runGit: GitCommandRunner,
): Promise<number> {
  const { stdout } = await runGit(['status', '--porcelain'], worktreePath);
  return stdout.split('\n').filter((line) => line.trim().length > 0).length;
}
