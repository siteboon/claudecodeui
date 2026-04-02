import { ChevronDown, ChevronRight } from 'lucide-react';
import { useMemo } from 'react';
import type { GitCommitSummary } from '../../types/types';
import { getStatusBadgeClass, parseCommitFiles } from '../../utils/gitPanelUtils';
import GitDiffViewer from '../shared/GitDiffViewer';

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

type CommitHistoryItemProps = {
  commit: GitCommitSummary;
  isExpanded: boolean;
  diff?: string;
  isMobile: boolean;
  wrapText: boolean;
  onToggle: () => void;
};

export default function CommitHistoryItem({
  commit,
  isExpanded,
  diff,
  isMobile,
  wrapText,
  onToggle,
}: CommitHistoryItemProps) {
  const fileSummary = useMemo(() => {
    if (!diff) return null;
    return parseCommitFiles(diff);
  }, [diff]);

  return (
    <div className="border-b border-border last:border-0">
      <button
        type="button"
        aria-expanded={isExpanded}
        className="flex w-full cursor-pointer items-start border-0 bg-transparent p-3 text-left transition-colors hover:bg-accent/50"
        onClick={onToggle}
      >
        <span className="mr-2 mt-1 rounded p-0.5 hover:bg-accent">
          {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">{commit.message}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {commit.author}
                {' \u2022 '}
                {commit.date}
              </p>
            </div>
            <span className="flex-shrink-0 font-mono text-sm text-muted-foreground/60">
              {commit.hash.substring(0, 7)}
            </span>
          </div>
        </div>
      </button>

      {isExpanded && diff && (
        <div className="bg-muted/50">
          <div className="max-h-[32rem] overflow-y-auto p-3">
            {/* Full hash */}
            <p className="mb-2 select-all font-mono text-xs text-muted-foreground/70">
              {commit.hash}
            </p>

            {/* Author + Date */}
            <div className="mb-3 flex gap-4 text-xs text-muted-foreground">
              <span>
                <span className="text-muted-foreground/60">Author </span>
                {commit.author}
              </span>
              <span>
                <span className="text-muted-foreground/60">Date </span>
                {formatDate(commit.date)}
              </span>
            </div>

            {/* Stats card */}
            {fileSummary && (
              <div className="mb-3 flex gap-4 rounded-md bg-muted/80 px-4 py-2 text-center text-xs">
                <div>
                  <div className="text-muted-foreground/60">Files</div>
                  <div className="font-semibold text-foreground">{fileSummary.totalFiles}</div>
                </div>
                <div>
                  <div className="text-muted-foreground/60">Added</div>
                  <div className="font-semibold text-green-600 dark:text-green-400">+{fileSummary.totalInsertions}</div>
                </div>
                <div>
                  <div className="text-muted-foreground/60">Removed</div>
                  <div className="font-semibold text-red-600 dark:text-red-400">-{fileSummary.totalDeletions}</div>
                </div>
              </div>
            )}

            {/* Changed files list */}
            {fileSummary && fileSummary.files.length > 0 && (
              <div className="mb-3">
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">
                  Changed Files
                </p>
                <div className="rounded-md border border-border/60">
                  {fileSummary.files.map((file, idx) => (
                    <div
                      key={file.path}
                      className={`flex items-center gap-2 px-2.5 py-1.5 text-xs ${
                        idx < fileSummary.files.length - 1 ? 'border-b border-border/40' : ''
                      }`}
                    >
                      <span
                        className={`inline-flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border text-[9px] font-bold ${getStatusBadgeClass(file.status)}`}
                      >
                        {file.status}
                      </span>
                      <span className="min-w-0 flex-1 truncate">
                        {file.directory && (
                          <span className="text-muted-foreground/60">{file.directory}</span>
                        )}
                        <span className="font-medium text-foreground">{file.filename}</span>
                      </span>
                      <span className="flex-shrink-0 font-mono text-muted-foreground/60">
                        {file.insertions > 0 && (
                          <span className="text-green-600 dark:text-green-400">+{file.insertions}</span>
                        )}
                        {file.insertions > 0 && file.deletions > 0 && '/'}
                        {file.deletions > 0 && (
                          <span className="text-red-600 dark:text-red-400">-{file.deletions}</span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Diff viewer */}
            <GitDiffViewer diff={diff} isMobile={isMobile} wrapText={wrapText} />
          </div>
        </div>
      )}
    </div>
  );
}
