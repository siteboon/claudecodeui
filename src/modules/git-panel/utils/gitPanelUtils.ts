import { FILE_STATUS_GROUPS } from '@/shared/constants';
import type { FileStatusCode, GitStatusResponse } from '@/shared/types';

const FILE_STATUS_LABELS: Record<FileStatusCode, string> = {
  M: 'git:status.modified',
  A: 'git:status.added',
  D: 'git:status.deleted',
  R: 'git:status.renamed',
  U: 'git:status.untracked',
};

const FILE_STATUS_BADGE_CLASSES: Record<FileStatusCode, string> = {
  M: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300 border-yellow-200 dark:border-yellow-800/50',
  A: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300 border-green-200 dark:border-green-800/50',
  D: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 border-red-200 dark:border-red-800/50',
  R: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 border-blue-200 dark:border-blue-800/50',
  U: 'bg-muted text-muted-foreground border-border',
};

export function getAllChangedFiles(gitStatus: GitStatusResponse | null): string[] {
  if (!gitStatus) {
    return [];
  }

  return FILE_STATUS_GROUPS.flatMap(({ key }) => gitStatus[key] || []);
}

export function getChangedFileCount(gitStatus: GitStatusResponse | null): number {
  return getAllChangedFiles(gitStatus).length;
}

export function hasChangedFiles(gitStatus: GitStatusResponse | null): boolean {
  return getChangedFileCount(gitStatus) > 0;
}

export function getStatusLabelKey(status: FileStatusCode): string {
  return FILE_STATUS_LABELS[status] || status;
}

export function getStatusBadgeClass(status: FileStatusCode): string {
  return FILE_STATUS_BADGE_CLASSES[status] || FILE_STATUS_BADGE_CLASSES.U;
}

// Preferred compare bases, in order: the usual integration branches locally,
// then their remote-tracking counterparts.
const PREFERRED_LOCAL_COMPARE_BASES = ['main', 'master', 'develop'];
const PREFERRED_REMOTE_COMPARE_BASES = ['origin/main', 'origin/master'];

/**
 * Used by useBranchCompare to pick the branch the Compare tab diffs against
 * before the user chooses one: a well-known integration branch if it exists,
 * otherwise any branch other than the current one, and finally the current
 * branch itself. Returns '' while both branch lists are empty (still loading,
 * or a repository without commits) so no comparison is requested against an
 * unverified name.
 */
export function pickDefaultCompareBase(
  localBranches: string[],
  remoteRefs: string[],
  currentBranch: string,
): string {
  if (localBranches.length === 0 && remoteRefs.length === 0) {
    return '';
  }

  const preferredLocal = PREFERRED_LOCAL_COMPARE_BASES.find((name) => localBranches.includes(name));
  if (preferredLocal) {
    return preferredLocal;
  }

  const preferredRemote = PREFERRED_REMOTE_COMPARE_BASES.find((name) => remoteRefs.includes(name));
  if (preferredRemote) {
    return preferredRemote;
  }

  const otherBranch = [...localBranches, ...remoteRefs].find((name) => name !== currentBranch);
  return otherBranch ?? currentBranch;
}

// ---------------------------------------------------------------------------
// Parse `git show` output to extract per-file change info
// ---------------------------------------------------------------------------

export type CommitFileChange = {
  path: string;
  directory: string;
  filename: string;
  status: FileStatusCode;
  insertions: number;
  deletions: number;
};

export type CommitFileSummary = {
  files: CommitFileChange[];
  totalFiles: number;
  totalInsertions: number;
  totalDeletions: number;
};

export function parseCommitFiles(showOutput: string): CommitFileSummary {
  const files: CommitFileChange[] = [];
  // Split on file diff boundaries
  const fileDiffs = showOutput.split(/^diff --git /m).slice(1);

  for (const section of fileDiffs) {
    const lines = section.split('\n');
    // Extract path from "a/path b/path"
    const header = lines[0] ?? '';
    const match = header.match(/^a\/(.+?) b\/(.+)/);
    if (!match) continue;

    const pathA = match[1];
    const pathB = match[2];

    // Determine status
    let status: FileStatusCode = 'M';
    const joined = lines.slice(0, 6).join('\n');
    if (joined.includes('new file mode')) status = 'A';
    else if (joined.includes('deleted file mode')) status = 'D';

    const filePath = status === 'D' ? pathA : pathB;

    // Count insertions/deletions (lines starting with +/- but not +++/---)
    let insertions = 0;
    let deletions = 0;
    for (const line of lines) {
      if (line.startsWith('+++') || line.startsWith('---')) continue;
      if (line.startsWith('+')) insertions++;
      else if (line.startsWith('-')) deletions++;
    }

    const lastSlash = filePath.lastIndexOf('/');
    const directory = lastSlash >= 0 ? filePath.substring(0, lastSlash + 1) : '';
    const filename = lastSlash >= 0 ? filePath.substring(lastSlash + 1) : filePath;

    files.push({ path: filePath, directory, filename, status, insertions, deletions });
  }

  return {
    files,
    totalFiles: files.length,
    totalInsertions: files.reduce((sum, f) => sum + f.insertions, 0),
    totalDeletions: files.reduce((sum, f) => sum + f.deletions, 0),
  };
}
