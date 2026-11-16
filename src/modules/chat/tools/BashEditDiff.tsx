import { Fragment, useMemo } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/shared/utils';
import type { DiffStats } from '@/shared/types';
import { CollapsibleDisplay } from '@/modules/chat/tools/CollapsibleDisplay';
import { DiffStatsBadge } from '@/modules/chat/tools/DiffStatsBadge';

type BashEditDiffHunk = {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  /** Unified-diff lines, each prefixed with ' ', '-', '+' or '\' (a "No newline" marker). */
  lines: string[];
};

type BashEditDiffFile = {
  filePath: string;
  hunks: BashEditDiffHunk[];
  created: boolean;
  deleted: boolean;
};

type BashEditDiffData = {
  files: BashEditDiffFile[];
  /** Changed files with no diff to draw: the CLI's own count plus any dropped by MAX_RENDERED_FILES. */
  moreFiles: number;
  /** The paths behind `moreFiles`: `changedFiles` entries that have no block of their own. */
  undiffedPaths: string[];
  /** The CLI could not diff all or part of the change. */
  unavailable: boolean;
  /** Another command changed the repository while this one ran, so either may own a change. */
  shared: boolean;
  /** A lone tree-rewriting git command (checkout, stash, pull, reset…) the CLI does not diff. */
  skipped: boolean;
};

// Claude Code itself stops at 5 files and 400 lines per file. These bounds sit
// above and below that: the file cap only matters for a payload that did not
// come from the CLI, and the line cap keeps a run of large rewrites from
// filling the transcript (the CLI's own terminal view stops at 40 lines).
const MAX_RENDERED_FILES = 20;
const MAX_RENDERED_LINES_PER_FILE = 200;
// The CLI keeps up to 200 changed paths; the note names this many and counts the rest.
const MAX_LISTED_UNDIFFED_PATHS = 10;

// The Edit diff viewer's colours (ToolDiffViewer), so a change made through Bash
// reads the same as one made through Edit.
const LINE_CLASSES = {
  added: {
    gutter: 'bg-green-50 text-green-400 dark:bg-green-950/30 dark:text-green-500',
    text: 'bg-green-50/50 text-green-800 dark:bg-green-950/20 dark:text-green-200',
  },
  removed: {
    gutter: 'bg-red-50 text-red-400 dark:bg-red-950/30 dark:text-red-500',
    text: 'bg-red-50/50 text-red-800 dark:bg-red-950/20 dark:text-red-200',
  },
  context: {
    gutter: 'text-gray-400 dark:text-gray-500',
    text: 'text-gray-600 dark:text-gray-400',
  },
} as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const readCount = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;

function readHunk(value: unknown): BashEditDiffHunk | null {
  if (!isRecord(value) || !Array.isArray(value.lines)) {
    return null;
  }

  return {
    oldStart: readCount(value.oldStart),
    oldLines: readCount(value.oldLines),
    newStart: readCount(value.newStart),
    newLines: readCount(value.newLines),
    lines: value.lines.filter((line): line is string => typeof line === 'string'),
  };
}

function readFile(value: unknown): BashEditDiffFile | null {
  if (!isRecord(value) || typeof value.filePath !== 'string' || !value.filePath) {
    return null;
  }

  // An empty list is a real empty file; a missing list, or one with nothing
  // readable in it, says nothing about the file, so it is not drawn as empty.
  if (!Array.isArray(value.hunks)) {
    return null;
  }
  const hunks = value.hunks.map(readHunk).filter((hunk): hunk is BashEditDiffHunk => hunk !== null);
  if (value.hunks.length > 0 && hunks.length === 0) {
    return null;
  }

  return {
    filePath: value.filePath,
    hunks,
    created: value.created === true,
    deleted: value.deleted === true,
  };
}

/**
 * Reads the `bashEditDiff` Claude Code records on a Bash result in `auto` and
 * `bypassPermissions` modes (or when `bashEditDiffEnabled` turns it on).
 *
 * The value arrives as untrusted JSON, from the transcript on disk or the live
 * SDK frame, so anything that does not have the documented shape is dropped
 * rather than drawn. Returns null when there is nothing to show — no field, or
 * a diff with no files and no flag to explain — so a Bash row without one
 * renders exactly as it did before.
 */
function readBashEditDiff(toolUseResult: unknown): BashEditDiffData | null {
  if (!isRecord(toolUseResult)) {
    return null;
  }

  const diff = toolUseResult.bashEditDiff;
  if (!isRecord(diff)) {
    return null;
  }

  // The CLI records `{ files: [], moreFiles: 0, skipped: true }` and nothing
  // else for the git commands it does not diff, and prints only that it skipped.
  if (diff.skipped === true) {
    return { files: [], moreFiles: 0, undiffedPaths: [], unavailable: false, shared: false, skipped: true };
  }

  const files: BashEditDiffFile[] = [];
  let droppedFiles = 0;
  for (const entry of Array.isArray(diff.files) ? diff.files : []) {
    const file = readFile(entry);
    if (!file) {
      continue;
    }
    if (files.length >= MAX_RENDERED_FILES) {
      droppedFiles += 1;
      continue;
    }
    files.push(file);
  }

  const moreFiles = readCount(diff.moreFiles) + droppedFiles;
  const unavailable = diff.unavailable === true;
  const shared = diff.shared === true;
  if (files.length === 0 && moreFiles === 0 && !unavailable && !shared) {
    return null;
  }

  const diffedPaths = new Set(files.map((file) => file.filePath));
  const undiffedPaths = moreFiles > 0 && Array.isArray(diff.changedFiles)
    ? [...new Set(diff.changedFiles.filter(
      (path): path is string => typeof path === 'string' && path !== '' && !diffedPaths.has(path),
    ))]
    : [];

  return { files, moreFiles, undiffedPaths, unavailable, shared, skipped: false };
}

/**
 * Counts every added and removed line, then keeps whole hunks until the line
 * budget runs out and cuts the hunk that crosses it — the same split the CLI
 * makes, so the stats always describe the full change even when the body is cut.
 */
function prepareFileDiff(file: BashEditDiffFile): {
  stats: DiffStats;
  hunks: BashEditDiffHunk[];
  hiddenLines: number;
} {
  let added = 0;
  let removed = 0;
  let budget = MAX_RENDERED_LINES_PER_FILE;
  let hiddenLines = 0;
  const hunks: BashEditDiffHunk[] = [];

  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      if (line.startsWith('+')) added += 1;
      else if (line.startsWith('-')) removed += 1;
    }

    if (budget <= 0) {
      hiddenLines += hunk.lines.length;
    } else if (hunk.lines.length <= budget) {
      hunks.push(hunk);
      budget -= hunk.lines.length;
    } else {
      hunks.push({ ...hunk, lines: hunk.lines.slice(0, budget) });
      hiddenLines += hunk.lines.length - budget;
      budget = 0;
    }
  }

  return { stats: { added, removed }, hunks, hiddenLines };
}

/**
 * The `@@ -a,b +c,d @@` line for a hunk. The side a created or deleted file
 * does not have starts at 0 in git's output, but the CLI writes 1 there in some
 * builds (2.1.280) and 0 in others, so that side is printed as git would.
 */
function formatHunkHeader(hunk: BashEditDiffHunk, file: BashEditDiffFile): string {
  const oldStart = file.created && hunk.oldLines === 0 ? 0 : hunk.oldStart;
  const newStart = file.deleted && hunk.newLines === 0 ? 0 : hunk.newStart;
  return `@@ -${oldStart},${hunk.oldLines} +${newStart},${hunk.newLines} @@`;
}

/** Shows a path relative to the project when it lies inside it, as the repository itself names it. */
function toProjectPath(filePath: string, projectRoot?: string): string {
  const root = projectRoot?.replace(/[\\/]+$/, '');
  if (root && (filePath.startsWith(`${root}/`) || filePath.startsWith(`${root}\\`))) {
    return filePath.slice(root.length + 1);
  }
  return filePath;
}

function BashEditDiffNote({ children }: { children: ReactNode }) {
  return (
    // The transparent border lines the note up with the file blocks' headers.
    <div className="border-l-2 border-transparent py-0.5 pl-3 text-[11px] text-muted-foreground">
      {children}
    </div>
  );
}

function BashEditDiffLine({ line }: { line: string }) {
  const marker = line.charAt(0);

  // `\ No newline at end of file` annotates the line above it rather than
  // being part of the file, so it gets no gutter sign or colour.
  if (marker === '\\') {
    return <div className="px-2 italic text-gray-400 dark:text-gray-500">{line}</div>;
  }

  const kind = marker === '+' ? 'added' : marker === '-' ? 'removed' : 'context';
  const content = marker === '+' || marker === '-' || marker === ' ' ? line.slice(1) : line;

  return (
    // min-h keeps an empty line one row tall instead of collapsing to nothing.
    <div className="flex min-h-[18px]">
      <span className={cn('w-6 flex-shrink-0 select-none text-center', LINE_CLASSES[kind].gutter)}>
        {kind === 'added' ? '+' : kind === 'removed' ? '-' : ''}
      </span>
      <span className={cn('flex-1 whitespace-pre-wrap break-all px-2', LINE_CLASSES[kind].text)}>
        {content}
      </span>
    </div>
  );
}

type BashEditDiffFileSectionProps = {
  file: BashEditDiffFile;
  onFileOpen?: (filePath: string) => void;
};

function BashEditDiffFileSection({ file, onFileOpen }: BashEditDiffFileSectionProps) {
  const { t } = useTranslation('chat');
  const { stats, hunks, hiddenLines } = prepareFileDiff(file);
  const fileName = file.filePath.split(/[\\/]/).pop() || file.filePath;
  const action = file.created
    ? t('bashEditDiff.created')
    : file.deleted
      ? t('bashEditDiff.deleted')
      : t('bashEditDiff.updated');
  // A deleted file has nothing left to open.
  const openFile = onFileOpen && !file.deleted ? () => onFileOpen(file.filePath) : undefined;

  return (
    <CollapsibleDisplay
      toolName={action}
      title={fileName}
      // A file name is mono whether or not it can be opened, so a deleted one
      // matches the others in the list.
      titleClassName="font-mono"
      toolCategory="edit"
      badge={stats.added > 0 || stats.removed > 0 ? <DiffStatsBadge stats={stats} /> : undefined}
      onTitleClick={openFile}
    >
      <div className="overflow-hidden rounded border border-gray-200/60 dark:border-gray-700/50">
        <div className="border-b border-gray-200/60 bg-gray-50/80 px-2.5 py-1 dark:border-gray-700/50 dark:bg-gray-800/40">
          <span className="block truncate font-mono text-[11px] text-gray-600 dark:text-gray-400">
            {file.filePath}
          </span>
        </div>

        <div className="font-mono text-[11px] leading-[18px]">
          {hunks.map((hunk, hunkIndex) => (
            <Fragment key={hunkIndex}>
              <div className="select-none bg-gray-50/80 px-2 text-gray-500 dark:bg-gray-800/40 dark:text-gray-400">
                {formatHunkHeader(hunk, file)}
              </div>
              {hunk.lines.map((line, lineIndex) => (
                <BashEditDiffLine key={lineIndex} line={line} />
              ))}
            </Fragment>
          ))}
          {hunks.length === 0 && (
            <div className="px-2 py-0.5 italic text-gray-400 dark:text-gray-500">
              {t('bashEditDiff.emptyFile')}
            </div>
          )}
          {hiddenLines > 0 && (
            <div className="px-2 py-0.5 text-gray-500 dark:text-gray-400">
              {t('bashEditDiff.moreLines', { count: hiddenLines })}
            </div>
          )}
        </div>
      </div>
    </CollapsibleDisplay>
  );
}

type BashEditDiffProps = {
  /** The Bash result's structured output; anything without a usable `bashEditDiff` draws nothing. */
  toolUseResult: unknown;
  onFileOpen?: (filePath: string) => void;
  /** The project's directory, so the files listed without a diff read as repository paths. */
  projectRoot?: string;
};

/**
 * What a Bash command changed on disk, one collapsible block per file in the
 * same shape as an Edit row, plus the CLI's notes on what it could not diff.
 *
 * Rendered by chat's ToolRenderer under the Bash command row, so a change made
 * through `sed -i`, a heredoc or a formatter is as reviewable as one made
 * through Edit. Draws nothing when the result carries no diff.
 */
export function BashEditDiff({ toolUseResult, onFileOpen, projectRoot }: BashEditDiffProps) {
  const { t } = useTranslation('chat');
  const diff = useMemo(() => readBashEditDiff(toolUseResult), [toolUseResult]);

  if (!diff) {
    return null;
  }

  // The notes below follow the CLI's own wording and order (Claude Code 2.1.280).
  if (diff.skipped) {
    return (
      <div className="mt-1">
        <BashEditDiffNote>{t('bashEditDiff.skipped')}</BashEditDiffNote>
      </div>
    );
  }

  const hasFiles = diff.files.length > 0;
  let moreFilesNote: string | null = null;
  if (diff.moreFiles > 0) {
    if (hasFiles) {
      moreFilesNote = t('bashEditDiff.moreFiles', { count: diff.moreFiles });
    } else if (diff.unavailable) {
      moreFilesNote = t('bashEditDiff.filesUnavailable', { count: diff.moreFiles });
    } else if (diff.shared) {
      // With another command writing at the same time, the CLI does not know
      // why these files have no diff, so the note does not guess.
      moreFilesNote = t('bashEditDiff.filesChanged', { count: diff.moreFiles });
    } else {
      moreFilesNote = t('bashEditDiff.filesNotShown', { count: diff.moreFiles });
    }
  }

  let unavailableNote: string | null = null;
  if (diff.unavailable && hasFiles) {
    unavailableNote = t('bashEditDiff.partUnavailable');
  } else if (diff.unavailable && !moreFilesNote) {
    unavailableNote = t('bashEditDiff.diffUnavailable');
  }
  // The partial-diff note qualifies the more-files line, so it joins it there.
  if (moreFilesNote && unavailableNote) {
    moreFilesNote = `${moreFilesNote} ${unavailableNote}`;
    unavailableNote = null;
  }

  const listedPaths = diff.undiffedPaths.slice(0, MAX_LISTED_UNDIFFED_PATHS);
  // The CLI stops changedFiles at 200 names but keeps counting in moreFiles.
  const unlistedPaths = Math.max(diff.moreFiles, diff.undiffedPaths.length) - listedPaths.length;
  // Like the CLI, a command it could not diff at all gets only that note.
  const showSharedCaveat = diff.shared && !(diff.unavailable && !hasFiles);

  return (
    <div className="mt-1">
      {diff.files.map((file, index) => (
        <BashEditDiffFileSection key={`${index}:${file.filePath}`} file={file} onFileOpen={onFileOpen} />
      ))}
      {moreFilesNote && (
        <BashEditDiffNote>
          {moreFilesNote}
          {listedPaths.length > 0 && (
            // Wraps between names, and inside a name only when it is longer than the line.
            <div className="break-words">
              {listedPaths.map((path, index) => (
                <Fragment key={path}>
                  {index > 0 && ', '}
                  <span className="font-mono" title={path}>{toProjectPath(path, projectRoot)}</span>
                </Fragment>
              ))}
              {unlistedPaths > 0 && ` ${t('bashEditDiff.morePaths', { count: unlistedPaths })}`}
            </div>
          )}
        </BashEditDiffNote>
      )}
      {unavailableNote && <BashEditDiffNote>{unavailableNote}</BashEditDiffNote>}
      {showSharedCaveat && <BashEditDiffNote>{t('bashEditDiff.shared')}</BashEditDiffNote>}
    </div>
  );
}
