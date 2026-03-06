import { ChevronDown, ChevronRight } from 'lucide-react';
import type { GitCommitSummary } from '../../types/types';
import GitDiffViewer from '../shared/GitDiffViewer';


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
          <div className="max-h-96 overflow-y-auto p-2">
            <div className="mb-2 font-mono text-sm text-muted-foreground">
              {commit.stats}
            </div>
            <GitDiffViewer diff={diff} isMobile={isMobile} wrapText={wrapText} />
          </div>
        </div>
      )}
    </div>
  );
}
