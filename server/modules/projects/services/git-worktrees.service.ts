/**
 * Worktree discovery for a project path.
 *
 * Read-only: runs `git worktree list --porcelain` and parses the output.
 * Creation/removal of worktrees stays in the user's shell.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

export type Worktree = {
  path: string;
  branch: string | null;
  isMain: boolean;
  isLocked: boolean;
};

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

/**
 * Parse the output of `git worktree list --porcelain`.
 * Blocks are separated by blank lines. Each block starts with a `worktree <path>` line.
 */
export function parseWorktreePorcelain(porcelain: string): Worktree[] {
  const blocks = porcelain.split(/\r?\n\r?\n/);
  const worktrees: Worktree[] = [];
  let firstNonBare = true;

  for (const block of blocks) {
    const lines = block.split(/\r?\n/).filter((line) => line.length > 0);
    if (lines.length === 0) continue;

    let path: string | null = null;
    let branchRef: string | null = null;
    let isDetached = false;
    let isBare = false;
    let isLocked = false;

    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        path = line.slice('worktree '.length);
      } else if (line.startsWith('branch ')) {
        branchRef = line.slice('branch '.length);
      } else if (line === 'detached') {
        isDetached = true;
      } else if (line === 'bare') {
        isBare = true;
      } else if (line === 'locked' || line.startsWith('locked ')) {
        isLocked = true;
      }
    }

    if (!path || isBare) continue;

    const branch = isDetached || !branchRef
      ? null
      : branchRef.replace(/^refs\/heads\//, '');

    const isMain = firstNonBare;
    firstNonBare = false;

    worktrees.push({ path, branch, isMain, isLocked });
  }

  return worktrees;
}

/**
 * Returns the list of worktrees for a given repo path.
 *
 * Returns `[]` when:
 *   - the path is not a git working tree
 *   - the `git` binary is unavailable
 *   - parsing yields nothing usable
 *
 * Stale entries (paths that no longer exist on disk) are filtered out
 * so the UI doesn't render dead worktrees after a manual `rm -rf`.
 */
export async function getWorktreesForRepo(repoPath: string): Promise<Worktree[]> {
  const insideCheck = await runGit(['rev-parse', '--is-inside-work-tree'], repoPath);
  if (insideCheck.code !== 0 || insideCheck.stdout.trim() !== 'true') {
    return [];
  }

  const listResult = await runGit(['worktree', 'list', '--porcelain'], repoPath);
  if (listResult.code !== 0) {
    return [];
  }

  const worktrees = parseWorktreePorcelain(listResult.stdout);
  return worktrees.filter((wt) => existsSync(wt.path));
}
