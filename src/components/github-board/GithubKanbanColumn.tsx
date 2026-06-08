import { ChevronLeft } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { GithubColumn, GithubIssue } from './types';
import GithubIssueCard from './GithubIssueCard';

type Props = {
  column: GithubColumn;
  issues: GithubIssue[];
  collapsed: boolean;
  onToggleCollapse: () => void;
  onIssueClick: (issue: GithubIssue) => void;
};

export default function GithubKanbanColumn({ column, issues, collapsed, onToggleCollapse, onIssueClick }: Props) {
  if (collapsed) {
    return (
      <button
        onClick={onToggleCollapse}
        title={`Expand ${column.title}`}
        className={cn(
          'flex h-full min-h-[200px] w-full flex-col items-center gap-3 rounded-xl border py-3 shadow-sm transition-shadow hover:shadow-md',
          column.color,
          column.headerColor,
        )}
      >
        <span className="rounded-full bg-white/60 px-2 py-1 text-xs font-medium dark:bg-black/20">
          {issues.length}
        </span>
        {/* Vertical title */}
        <span
          className="text-sm font-semibold tracking-wide"
          style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
        >
          {column.title}
        </span>
      </button>
    );
  }

  return (
    <div className={cn('rounded-xl border shadow-sm transition-shadow hover:shadow-md', column.color)}>
      <button
        onClick={onToggleCollapse}
        title={`Collapse ${column.title}`}
        className={cn('w-full px-4 py-3 rounded-t-xl border-b cursor-pointer', column.headerColor)}
      >
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-1 text-sm font-semibold">
            <ChevronLeft className="h-3.5 w-3.5 opacity-60" />
            {column.title}
          </h3>
          <span className="rounded-full bg-white/60 px-2 py-1 text-xs font-medium dark:bg-black/20">
            {issues.length}
          </span>
        </div>
      </button>

      <div className="max-h-[calc(100vh-300px)] min-h-[200px] space-y-3 overflow-y-auto p-3">
        {issues.length === 0 ? (
          <div className="py-8 text-center">
            <div className="mx-auto mb-2 flex h-8 w-8 items-center justify-center rounded-full bg-gray-200 dark:bg-gray-700">
              <div className="h-3 w-3 rounded-full bg-gray-300 dark:bg-gray-600" />
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400">No issues</div>
          </div>
        ) : (
          issues.map(issue => (
            <GithubIssueCard
              key={issue.number}
              issue={issue}
              onClick={() => onIssueClick(issue)}
            />
          ))
        )}
      </div>
    </div>
  );
}
