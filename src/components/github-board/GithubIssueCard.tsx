import { memo } from 'react';
import { MessageSquare } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { GithubIssue } from './types';
import { getIssuePriority, PRIORITY_CONFIG } from './types';

type Props = {
  issue: GithubIssue;
  onClick: () => void;
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`]+`/g, '')
    .replace(/[*_~>#[\]!]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function LabelBadge({ label }: { label: { name: string; color: string } }) {
  const hex = label.color.startsWith('#') ? label.color : `#${label.color}`;
  return (
    <span
      className="inline-block rounded-full px-2 py-0.5 text-xs font-medium"
      style={{ backgroundColor: `${hex}33`, color: hex, border: `1px solid ${hex}55` }}
    >
      {label.name}
    </span>
  );
}

function GithubIssueCard({ issue, onClick }: Props) {
  const preview = issue.body ? stripMarkdown(issue.body).slice(0, 100) : '';
  const STATUS_LABELS = ['in-progress', 'review', 'blocked', 'deferred', 'cancelled', 'priority:high', 'priority:medium', 'priority:low'];
  const visibleLabels = issue.labels.filter(l => !STATUS_LABELS.includes(l.name)).slice(0, 3);
  const priority = getIssuePriority(issue);

  return (
    <div
      className={cn(
        'rounded-lg border border-gray-200 bg-white p-3 space-y-2',
        'dark:border-gray-700 dark:bg-gray-800',
        'hover:shadow-md hover:border-blue-300 dark:hover:border-blue-600',
        'transition-all duration-200 cursor-pointer hover:-translate-y-0.5',
      )}
      onClick={onClick}
    >
      {/* Issue number + priority dot + labels */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-mono text-xs text-gray-400 dark:text-gray-500">#{issue.number}</span>
        {priority && (
          <span className={cn('inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-xs font-medium', PRIORITY_CONFIG[priority].badge)}>
            <span className={cn('h-1.5 w-1.5 rounded-full', PRIORITY_CONFIG[priority].dot)} />
            {PRIORITY_CONFIG[priority].label}
          </span>
        )}
        {visibleLabels.map(l => <LabelBadge key={l.name} label={l} />)}
      </div>

      {/* Title */}
      <h3 className="line-clamp-2 text-sm font-medium leading-tight text-gray-900 dark:text-white">
        {issue.title}
      </h3>

      {/* Body preview */}
      {preview && (
        <p className="line-clamp-2 text-xs text-gray-500 dark:text-gray-400">{preview}</p>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between pt-0.5">
        <div className="flex items-center gap-2">
          {issue.assignees.length > 0 && (
            <div className="flex -space-x-1">
              {issue.assignees.slice(0, 3).map(a => (
                <img
                  key={a.login}
                  src={a.avatar_url}
                  alt={a.login}
                  title={a.login}
                  className="h-5 w-5 rounded-full border border-white dark:border-gray-800"
                />
              ))}
            </div>
          )}
          <span className="text-xs text-gray-400 dark:text-gray-500">{timeAgo(issue.updated_at)}</span>
        </div>
        {issue.comments > 0 && (
          <div className="flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500">
            <MessageSquare className="h-3 w-3" />
            {issue.comments}
          </div>
        )}
      </div>
    </div>
  );
}

export default memo(GithubIssueCard);
