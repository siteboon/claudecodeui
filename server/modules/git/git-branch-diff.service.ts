import path from 'node:path';

import type { GitProcessRunner } from '@/shared/types.js';
import { AppError, getGitErrorDetails } from '@/shared/utils.js';

// Single-letter status the Compare tab renders as a badge. Git's own
// `--name-status` letters are folded into this set (see `toBranchDiffStatus`).
type BranchDiffFileStatus = 'M' | 'A' | 'D' | 'R' | 'U';

type BranchDiffFile = {
  path: string;
  /** Pre-rename path, only present for `R` entries. */
  oldPath?: string;
  status: BranchDiffFileStatus;
};

type BranchDiffInput = {
  /** Repository root — every reported path is relative to it. */
  projectPath: string;
  /** Branch or remote-tracking ref the working copy is compared against. */
  base: string;
  runCommand: GitProcessRunner;
};

type BranchDiffFileInput = BranchDiffInput & {
  /** Repository-relative path of the file to diff. */
  file: string;
  /**
   * Pre-rename path for `R` entries. Diffing only the new path would make git
   * report the whole file as added, so both paths are handed to git together
   * and it pairs them into a rename with just the real content changes.
   */
  oldPath?: string;
  /** Reads an untracked file so its content can be rendered as an all-additions diff. */
  readFile: (absolutePath: string) => Promise<string>;
};

function toBranchDiffStatus(rawStatus: string): BranchDiffFileStatus {
  // `--name-status` emits R<score>/C<score> for renames and copies; a copy is
  // a brand-new file from the reader's point of view, and type changes (T) are
  // modifications.
  switch (rawStatus.charAt(0)) {
    case 'A':
    case 'C':
      return 'A';
    case 'D':
      return 'D';
    case 'R':
      return 'R';
    default:
      return 'M';
  }
}

function parseNameStatus(output: string): BranchDiffFile[] {
  // `-z` output is `<status>\0<path>\0`, with renames/copies contributing a
  // second path: `R100\0<old>\0<new>\0`. A trailing NUL leaves an empty token.
  const tokens = output.split('\0');
  const files: BranchDiffFile[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const rawStatus = tokens[index];
    if (!rawStatus) {
      continue;
    }

    const status = toBranchDiffStatus(rawStatus);
    const isTwoPathEntry = rawStatus.startsWith('R') || rawStatus.startsWith('C');
    const firstPath = tokens[index + 1];
    const secondPath = isTwoPathEntry ? tokens[index + 2] : undefined;
    index += isTwoPathEntry ? 2 : 1;

    if (!firstPath) {
      continue;
    }

    if (isTwoPathEntry) {
      if (!secondPath) {
        continue;
      }
      files.push(status === 'R' ? { path: secondPath, oldPath: firstPath, status } : { path: secondPath, status });
      continue;
    }

    files.push({ path: firstPath, status });
  }

  return files;
}

function parseUntrackedPaths(output: string): string[] {
  return output.split('\0').filter(Boolean);
}

/**
 * Turns a user-chosen base branch into the merge-base commit shared with HEAD.
 * Rejects refs that would parse as git options and refs git cannot resolve
 * before running `merge-base`, so the routes answer with a 400 and a stable
 * code instead of a raw git failure.
 */
async function resolveMergeBase(input: BranchDiffInput): Promise<string> {
  const { projectPath, base, runCommand } = input;
  const cwd = { cwd: projectPath };

  // validateBranchName in the routes accepts a leading '-', which git would
  // otherwise read as an option (e.g. `--output=file`).
  if (!base || base.startsWith('-')) {
    throw new AppError(`Invalid base branch "${base}"`, {
      code: 'GIT_INVALID_BASE_REF',
      statusCode: 400,
    });
  }

  try {
    await runCommand('git', ['rev-parse', '--verify', '--quiet', '--end-of-options', `${base}^{commit}`], cwd);
  } catch {
    throw new AppError(`Unknown branch or ref "${base}"`, {
      code: 'GIT_UNKNOWN_BASE_REF',
      statusCode: 400,
    });
  }

  let mergeBaseOutput: string;
  try {
    ({ stdout: mergeBaseOutput } = await runCommand('git', ['merge-base', '--', base, 'HEAD'], cwd));
  } catch (error) {
    throw new AppError(`"${base}" and the current branch share no common history`, {
      code: 'GIT_NO_MERGE_BASE',
      statusCode: 400,
      details: getGitErrorDetails(error),
    });
  }

  const mergeBase = mergeBaseOutput.trim();
  if (!mergeBase) {
    throw new AppError(`"${base}" and the current branch share no common history`, {
      code: 'GIT_NO_MERGE_BASE',
      statusCode: 400,
    });
  }

  return mergeBase;
}

/**
 * Used by the Git routes module for `GET /branch-diff`: lists every file the
 * working copy (committed, staged, unstaged and untracked) differs in from the
 * merge base of `base` and HEAD — the PR-style "what this branch changed".
 * Results are sorted by path.
 */
export async function listBranchDiffFiles(input: BranchDiffInput): Promise<{
  base: string;
  mergeBase: string;
  files: BranchDiffFile[];
}> {
  const { projectPath, base, runCommand } = input;
  const cwd = { cwd: projectPath };
  const mergeBase = await resolveMergeBase(input);

  // `git diff <commit>` compares the working tree (index + unstaged edits)
  // against the commit, which is exactly the "everything so far" view.
  const [{ stdout: nameStatusOutput }, { stdout: untrackedOutput }] = await Promise.all([
    runCommand('git', ['diff', '--name-status', '-M', '-z', mergeBase, '--'], cwd),
    runCommand('git', ['ls-files', '--others', '--exclude-standard', '-z'], cwd),
  ]);

  const files = [
    ...parseNameStatus(nameStatusOutput),
    ...parseUntrackedPaths(untrackedOutput).map((path): BranchDiffFile => ({ path, status: 'U' })),
  ].sort((left, right) => left.path.localeCompare(right.path));

  return { base, mergeBase, files };
}

/**
 * Used by the Git routes module for `GET /branch-diff/file`: the raw unified
 * diff of one file between the merge base and the working copy. Untracked
 * files are not visible to `git diff`, so their content is synthesized into
 * the same all-additions shape the `/diff` route produces.
 */
export async function getBranchDiffForFile(input: BranchDiffFileInput): Promise<string> {
  const { projectPath, file, oldPath, runCommand, readFile } = input;
  const cwd = { cwd: projectPath };
  const mergeBase = await resolveMergeBase(input);

  // Ask git (not the filesystem) whether the path is untracked so a path that
  // escapes the repository is rejected by git before anything is read.
  const { stdout: untrackedOutput } = await runCommand(
    'git',
    ['ls-files', '--others', '--exclude-standard', '-z', '--', file],
    cwd,
  );
  const isUntracked = parseUntrackedPaths(untrackedOutput).includes(file);

  if (isUntracked) {
    const content = await readFile(path.join(projectPath, file));
    const lines = content.split('\n');
    return `--- /dev/null\n+++ b/${file}\n@@ -0,0 +1,${lines.length} @@\n${lines.map((line) => `+${line}`).join('\n')}`;
  }

  const pathspecs = oldPath && oldPath !== file ? [oldPath, file] : [file];
  const { stdout: diff } = await runCommand('git', ['diff', '-M', mergeBase, '--', ...pathspecs], cwd);
  return diff;
}
