import spawn from 'cross-spawn';

import { AppError } from '@/shared/utils.js';

export type GitResult = { stdout: string; stderr: string };

/**
 * Runs `git <args>` with an argv array (never a shell string), so paths with spaces
 * and arbitrary user text are passed through untouched.
 */
export function git(args: string[], cwd: string, input?: string): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd, shell: false, windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (data: Buffer) => { stdout += data.toString(); });
    child.stderr?.on('data', (data: Buffer) => { stderr += data.toString(); });
    child.on('error', (error) => {
      reject(new AppError(`Failed to run git: ${error.message}`, { code: 'GIT_SPAWN_FAILED', statusCode: 500 }));
    });
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new AppError(`git ${args[0]} failed`, {
        code: 'GIT_COMMAND_FAILED',
        statusCode: 500,
        details: (stderr || stdout).trim(),
      }));
    });
    if (input !== undefined) {
      child.stdin?.end(input);
    }
  });
}

/** Like `git`, but returns null instead of rejecting. */
export async function gitOrNull(args: string[], cwd: string): Promise<string | null> {
  try {
    return (await git(args, cwd)).stdout;
  } catch {
    return null;
  }
}

export type DiffFile = {
  path: string;
  status: 'added' | 'deleted' | 'modified' | 'renamed' | 'untracked';
  additions: number;
  deletions: number;
  patch: string;
};

/** Splits a unified `git diff` into per-file entries. */
export function parseUnifiedDiff(diff: string): DiffFile[] {
  if (!diff.trim()) return [];
  const chunks = diff.split(/^diff --git /m).filter((chunk) => chunk.trim());
  return chunks.map((chunk) => {
    const header = chunk.split('\n', 1)[0];
    const match = /^a\/(.+?) b\/(.+)$/.exec(header);
    const filePath = match ? match[2] : header;
    let status: DiffFile['status'] = 'modified';
    if (/^new file mode/m.test(chunk)) status = 'added';
    else if (/^deleted file mode/m.test(chunk)) status = 'deleted';
    else if (/^rename from/m.test(chunk)) status = 'renamed';
    let additions = 0;
    let deletions = 0;
    let inHunk = false;
    for (const line of chunk.split('\n')) {
      if (line.startsWith('@@')) { inHunk = true; continue; }
      if (!inHunk) continue;
      if (line.startsWith('+')) additions += 1;
      else if (line.startsWith('-')) deletions += 1;
    }
    return { path: filePath, status, additions, deletions, patch: `diff --git ${chunk}` };
  });
}
