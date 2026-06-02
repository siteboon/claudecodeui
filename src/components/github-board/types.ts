export type GithubLabel = {
  id: number;
  name: string;
  color: string;
  description?: string;
};

export type GithubUser = {
  login: string;
  avatar_url: string;
  html_url: string;
};

export type GithubIssue = {
  number: number;
  title: string;
  body: string | null;
  state: 'open' | 'closed';
  labels: GithubLabel[];
  assignees: GithubUser[];
  user: GithubUser;
  created_at: string;
  updated_at: string;
  html_url: string;
  comments: number;
  milestone?: { title: string } | null;
  columnId?: string;
};

export type GithubComment = {
  id: number;
  body: string;
  user: GithubUser;
  created_at: string;
  updated_at: string;
};

export type GithubColumn = {
  id: string;
  title: string;
  state: string;
  labels: string[];
  color: string;
  headerColor: string;
};

export type IssuePriority = 'high' | 'medium' | 'low';

export const PRIORITY_LABELS = ['priority:high', 'priority:medium', 'priority:low'] as const;

export function getIssuePriority(issue: GithubIssue): IssuePriority | null {
  const names = issue.labels.map(l => l.name);
  if (names.includes('priority:high')) return 'high';
  if (names.includes('priority:medium')) return 'medium';
  if (names.includes('priority:low')) return 'low';
  return null;
}

export const PRIORITY_CONFIG: Record<IssuePriority, { label: string; dot: string; badge: string }> = {
  high:   { label: 'High',   dot: 'bg-rose-500',   badge: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400' },
  medium: { label: 'Medium', dot: 'bg-amber-400',  badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
  low:    { label: 'Low',    dot: 'bg-slate-400',  badge: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400' },
};
