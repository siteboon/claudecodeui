import { ChevronDown, ChevronRight } from 'lucide-react';
import DiffViewer from '../../../DiffViewer.jsx';
import type { GitCommitSummary } from '../../types/types';

type DiffViewerProps = {
  diff: string;
  fileName: string;
  isMobile: boolean;
  wrapText: boolean;
};

const DiffViewerComponent = DiffViewer as unknown as (props: DiffViewerProps) => JSX.Element;

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
      <div
        className="flex items-start p-3 hover:bg-accent/50 cursor-pointer transition-colors"
        onClick={onToggle}
      >
        <span className="mr-2 mt-1 p-0.5 hover:bg-accent rounded">
          {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground truncate">{commit.message}</p>
              <p className="text-sm text-muted-foreground mt-1">
                {commit.author}
                {' \u2022 '}
                {commit.date}
              </p>
            </div>
            <span className="text-sm font-mono text-muted-foreground/60 flex-shrink-0">
              {commit.hash.substring(0, 7)}
            </span>
          </div>
        </div>
      </div>

      {isExpanded && diff && (
        <div className="bg-muted/50">
          <div className="max-h-96 overflow-y-auto p-2">
            <div className="text-sm font-mono text-muted-foreground mb-2">
              {commit.stats}
            </div>
            <DiffViewerComponent diff={diff} fileName="commit" isMobile={isMobile} wrapText={wrapText} />
          </div>
        </div>
      )}
    </div>
  );
}
