import { History, RefreshCw } from 'lucide-react';
import { useCallback, useState } from 'react';
import type { GitDiffMap, GitCommitSummary } from '../../types/types';
import CommitHistoryItem from './CommitHistoryItem';

type HistoryViewProps = {
  isMobile: boolean;
  isLoading: boolean;
  recentCommits: GitCommitSummary[];
  commitDiffs: GitDiffMap;
  wrapText: boolean;
  onFetchCommitDiff: (commitHash: string) => Promise<void>;
};

export default function HistoryView({
  isMobile,
  isLoading,
  recentCommits,
  commitDiffs,
  wrapText,
  onFetchCommitDiff,
}: HistoryViewProps) {
  const [expandedCommits, setExpandedCommits] = useState<Set<string>>(new Set());

  const toggleCommitExpanded = useCallback(
    (commitHash: string) => {
      const isExpanding = !expandedCommits.has(commitHash);

      setExpandedCommits((previous) => {
        const next = new Set(previous);
        if (next.has(commitHash)) {
          next.delete(commitHash);
        } else {
          next.add(commitHash);
        }
        return next;
      });

      // Load commit diff lazily only the first time a commit is expanded.
      if (isExpanding && !commitDiffs[commitHash]) {
        onFetchCommitDiff(commitHash).catch((err) => {
          console.error('Failed to fetch commit diff:', err);
        });
      }
    },
    [commitDiffs, expandedCommits, onFetchCommitDiff, setExpandedCommits],
  );

  return (
    <div className={`flex-1 overflow-y-auto ${isMobile ? 'pb-mobile-nav' : ''}`}>
      {isLoading ? (
        <div className="flex items-center justify-center h-32">
          <RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : recentCommits.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
          <History className="w-10 h-10 mb-2 opacity-40" />
          <p className="text-sm">No commits found</p>
        </div>
      ) : (
        <div className={isMobile ? 'pb-4' : ''}>
          {recentCommits.map((commit) => (
            <CommitHistoryItem
              key={commit.hash}
              commit={commit}
              isExpanded={expandedCommits.has(commit.hash)}
              diff={commitDiffs[commit.hash]}
              isMobile={isMobile}
              wrapText={wrapText}
              onToggle={() => toggleCommitExpanded(commit.hash)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
