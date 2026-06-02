import { cn } from '../../lib/utils';
import type { GithubColumn, GithubIssue } from './types';
import GithubIssueCard from './GithubIssueCard';

type Props = {
  column: GithubColumn;
  issues: GithubIssue[];
  onIssueClick: (issue: GithubIssue) => void;
};

export default function GithubKanbanColumn({ column, issues, onIssueClick }: Props) {
  return (
    <div className={cn('rounded-xl border shadow-sm transition-shadow hover:shadow-md', column.color)}>
      <div className={cn('px-4 py-3 rounded-t-xl border-b', column.headerColor)}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">{column.title}</h3>
          <span className="rounded-full bg-white/60 px-2 py-1 text-xs font-medium dark:bg-black/20">
            {issues.length}
          </span>
        </div>
      </div>

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
