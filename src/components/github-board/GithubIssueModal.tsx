import { useCallback, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ExternalLink, Loader2, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { api } from '../../utils/api';
import type { GithubColumn, GithubComment, GithubIssue, IssuePriority } from './types';
import { getIssuePriority, PRIORITY_CONFIG, PRIORITY_LABELS } from './types';

type Props = {
  issue: GithubIssue | null;
  isOpen: boolean;
  projectId: string;
  columns: GithubColumn[];
  onClose: () => void;
  onStatusChange: (issue: GithubIssue, toColumnId: string) => void;
};

const MODAL_SIZE_KEY = 'github-issue-modal-size';
const MIN_W = 480;
const MIN_H = 360;

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function LabelBadge({ label }: { label: { name: string; color: string } }) {
  const hex = label.color.startsWith('#') ? label.color : `#${label.color}`;
  return (
    <span
      className="inline-block rounded-full px-2.5 py-0.5 text-xs font-medium"
      style={{ backgroundColor: `${hex}33`, color: hex, border: `1px solid ${hex}55` }}
    >
      {label.name}
    </span>
  );
}

const markdownComponents = {
  a: ({ href, children, ...props }: React.ComponentPropsWithoutRef<'a'>) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline" {...props}>{children}</a>
  ),
  code: ({ className, children, ...props }: React.ComponentPropsWithoutRef<'code'>) => {
    const isBlock = className?.includes('language-');
    return isBlock ? (
      <code className={cn('block rounded-md bg-gray-100 dark:bg-gray-800 px-4 py-3 text-sm font-mono overflow-x-auto', className)} {...props}>{children}</code>
    ) : (
      <code className="rounded bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 text-xs font-mono" {...props}>{children}</code>
    );
  },
  pre: ({ children }: React.ComponentPropsWithoutRef<'pre'>) => <pre className="my-3 overflow-x-auto rounded-md bg-gray-100 dark:bg-gray-800 p-0">{children}</pre>,
  blockquote: ({ children }: React.ComponentPropsWithoutRef<'blockquote'>) => (
    <blockquote className="border-l-4 border-gray-300 dark:border-gray-600 pl-4 text-gray-600 dark:text-gray-400 italic my-3">{children}</blockquote>
  ),
  ul: ({ children }: React.ComponentPropsWithoutRef<'ul'>) => <ul className="my-2 list-disc space-y-1 pl-6 text-sm">{children}</ul>,
  ol: ({ children }: React.ComponentPropsWithoutRef<'ol'>) => <ol className="my-2 list-decimal space-y-1 pl-6 text-sm">{children}</ol>,
  li: ({ children }: React.ComponentPropsWithoutRef<'li'>) => <li className="text-gray-700 dark:text-gray-300">{children}</li>,
  h1: ({ children }: React.ComponentPropsWithoutRef<'h1'>) => <h1 className="mt-4 mb-2 text-xl font-bold text-gray-900 dark:text-white">{children}</h1>,
  h2: ({ children }: React.ComponentPropsWithoutRef<'h2'>) => <h2 className="mt-3 mb-2 text-lg font-semibold text-gray-900 dark:text-white">{children}</h2>,
  h3: ({ children }: React.ComponentPropsWithoutRef<'h3'>) => <h3 className="mt-2 mb-1 text-base font-semibold text-gray-900 dark:text-white">{children}</h3>,
  p: ({ children }: React.ComponentPropsWithoutRef<'p'>) => <p className="my-1.5 text-sm leading-relaxed text-gray-700 dark:text-gray-300">{children}</p>,
  table: ({ children }: React.ComponentPropsWithoutRef<'table'>) => <div className="overflow-x-auto my-3"><table className="min-w-full text-sm border-collapse">{children}</table></div>,
  th: ({ children }: React.ComponentPropsWithoutRef<'th'>) => <th className="border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-2 text-left font-semibold">{children}</th>,
  td: ({ children }: React.ComponentPropsWithoutRef<'td'>) => <td className="border border-gray-200 dark:border-gray-700 px-3 py-2">{children}</td>,
  input: ({ type, checked, ...props }: React.ComponentPropsWithoutRef<'input'>) =>
    type === 'checkbox' ? <input type="checkbox" checked={checked} readOnly className="mr-1.5 rounded" {...props} /> : <input type={type} {...props} />,
};

function loadSavedSize(): { width: number; height: number } | null {
  try {
    const s = localStorage.getItem(MODAL_SIZE_KEY);
    if (!s) return null;
    const parsed = JSON.parse(s) as { width: number; height: number };
    if (typeof parsed.width === 'number' && typeof parsed.height === 'number') return parsed;
  } catch { /* ignore */ }
  return null;
}

export default function GithubIssueModal({ issue, isOpen, projectId, columns, onClose, onStatusChange }: Props) {
  const [comments, setComments] = useState<GithubComment[]>([]);
  const [loadingComments, setLoadingComments] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [updatingPriority, setUpdatingPriority] = useState(false);
  const [localPriority, setLocalPriority] = useState<IssuePriority | null>(null);

  useEffect(() => {
    setLocalPriority(issue ? getIssuePriority(issue) : null);
  }, [issue]);

  // Resizable modal size
  const [modalSize, setModalSize] = useState<{ width: number; height: number }>(() => {
    const saved = loadSavedSize();
    if (saved) return saved;
    return { width: Math.min(800, window.innerWidth - 48), height: Math.min(Math.round(window.innerHeight * 0.88), window.innerHeight - 48) };
  });

  const isResizing = useRef(false);
  const resizeStart = useRef({ x: 0, y: 0, w: 0, h: 0 });

  const onResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;
    resizeStart.current = { x: e.clientX, y: e.clientY, w: modalSize.width, h: modalSize.height };

    const onMove = (ev: MouseEvent) => {
      if (!isResizing.current) return;
      const dx = ev.clientX - resizeStart.current.x;
      const dy = ev.clientY - resizeStart.current.y;
      const maxW = window.innerWidth - 48;
      const maxH = window.innerHeight - 48;
      const newW = Math.max(MIN_W, Math.min(maxW, resizeStart.current.w + dx));
      const newH = Math.max(MIN_H, Math.min(maxH, resizeStart.current.h + dy));
      setModalSize({ width: newW, height: newH });
    };

    const onUp = () => {
      isResizing.current = false;
      setModalSize(prev => {
        localStorage.setItem(MODAL_SIZE_KEY, JSON.stringify(prev));
        return prev;
      });
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [modalSize.width, modalSize.height]);

  // Clamp size if window resizes
  useEffect(() => {
    const handler = () => {
      setModalSize(prev => {
        const maxW = window.innerWidth - 48;
        const maxH = window.innerHeight - 48;
        const w = Math.min(prev.width, maxW);
        const h = Math.min(prev.height, maxH);
        if (w !== prev.width || h !== prev.height) return { width: w, height: h };
        return prev;
      });
    };
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  useEffect(() => {
    if (!isOpen || !issue || !projectId) return;
    setLoadingComments(true);
    api.github.getComments(projectId, issue.number)
      .then(async r => {
        const data = await r.json() as { comments: GithubComment[] };
        setComments(data.comments || []);
      })
      .catch(() => setComments([]))
      .finally(() => setLoadingComments(false));
  }, [isOpen, issue?.number, projectId]);

  const handleColumnChange = async (toColumnId: string) => {
    if (!issue || updatingStatus) return;
    setUpdatingStatus(true);
    try {
      const STATUS_LABELS = ['in-progress', 'review', 'blocked'];
      const toCol = columns.find(c => c.id === toColumnId);
      if (!toCol) return;
      const patch: Record<string, unknown> = { state: toCol.state };
      const currentLabels = (issue.labels || []).map(l => l.name);
      const filtered = currentLabels.filter(l => !STATUS_LABELS.includes(l));
      patch.labels = [...new Set([...filtered, ...toCol.labels])];
      await api.github.updateIssue(projectId, issue.number, patch);
      onStatusChange(issue, toColumnId);
      onClose();
    } finally {
      setUpdatingStatus(false);
    }
  };

  const handlePriorityChange = async (priority: IssuePriority | null) => {
    if (!issue || updatingPriority) return;
    setUpdatingPriority(true);
    try {
      const currentLabels = (issue.labels || []).map(l => l.name);
      const filtered = currentLabels.filter(l => !PRIORITY_LABELS.includes(l as typeof PRIORITY_LABELS[number]));
      const newLabels = priority ? [...filtered, `priority:${priority}`] : filtered;
      await api.github.updateIssue(projectId, issue.number, { labels: newLabels });
      setLocalPriority(priority);
    } finally {
      setUpdatingPriority(false);
    }
  };

  if (!isOpen || !issue) return null;

  const currentColumnId = issue.columnId || 'todo';
  const openedAgo = timeAgo(issue.created_at);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="relative flex flex-col overflow-hidden rounded-xl bg-white shadow-2xl dark:bg-gray-900"
        style={{ width: modalSize.width, height: modalSize.height, maxWidth: '100vw', maxHeight: '100vh' }}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-gray-200 px-6 py-4 dark:border-gray-700">
          <div className="min-w-0 flex-1">
            {/* Issue number + state */}
            <div className="mb-1 flex items-center gap-2">
              <span className={cn(
                'rounded-full px-2.5 py-0.5 text-xs font-medium',
                issue.state === 'open'
                  ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                  : 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400'
              )}>
                {issue.state === 'open' ? 'Open' : 'Closed'}
              </span>
              <span className="font-mono text-sm text-gray-400">#{issue.number}</span>
              <span className="text-xs text-gray-400 dark:text-gray-500">
                by <strong>{issue.user.login}</strong> · {openedAgo}
                {issue.comments > 0 && ` · ${issue.comments} comments`}
              </span>
            </div>

            {/* Title */}
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">{issue.title}</h2>

            {/* Priority pills */}
            <div className="mt-2 flex flex-wrap items-center gap-1">
              <span className="mr-1 text-xs text-gray-400 dark:text-gray-500">Priority:</span>
              {(['high', 'medium', 'low'] as IssuePriority[]).map(p => (
                <button
                  key={p}
                  onClick={() => { void handlePriorityChange(localPriority === p ? null : p); }}
                  disabled={updatingPriority}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium transition-colors',
                    localPriority === p
                      ? PRIORITY_CONFIG[p].badge + ' ring-1 ring-current'
                      : 'bg-gray-100 text-gray-400 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-500 dark:hover:bg-gray-700',
                    updatingPriority && 'opacity-50 cursor-not-allowed'
                  )}
                  title={localPriority === p ? 'Click to remove priority' : `Set ${p} priority`}
                >
                  <span className={cn('h-1.5 w-1.5 rounded-full', PRIORITY_CONFIG[p].dot)} />
                  {PRIORITY_CONFIG[p].label}
                </button>
              ))}
              {updatingPriority && <Loader2 className="h-3 w-3 animate-spin text-gray-400" />}
            </div>

            {/* Status pills — inline, one line below title */}
            <div className="mt-1.5 flex flex-wrap items-center gap-1">
              <span className="mr-1 text-xs text-gray-400 dark:text-gray-500">Move to:</span>
              {columns.map(col => (
                <button
                  key={col.id}
                  onClick={() => { void handleColumnChange(col.id); }}
                  disabled={updatingStatus || col.id === currentColumnId}
                  className={cn(
                    'rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors',
                    col.id === currentColumnId
                      ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 cursor-default ring-1 ring-blue-300 dark:ring-blue-700'
                      : 'bg-gray-100 text-gray-500 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700',
                    updatingStatus && 'opacity-50 cursor-not-allowed'
                  )}
                >
                  {updatingStatus && col.id !== currentColumnId ? '…' : col.title}
                </button>
              ))}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <a
              href={issue.html_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              <ExternalLink className="h-3 w-3" />
              GitHub
            </a>
            <button onClick={onClose} className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          <div className="space-y-4 px-6 py-5">
            {/* Labels + assignees row */}
            {(issue.labels.length > 0 || issue.assignees.length > 0) && (
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex flex-wrap gap-1">
                  {issue.labels.map(l => <LabelBadge key={l.name} label={l} />)}
                </div>
                {issue.assignees.length > 0 && (
                  <div className="flex items-center gap-1">
                    {issue.assignees.slice(0, 4).map(a => (
                      <a key={a.login} href={a.html_url} target="_blank" rel="noopener noreferrer" title={a.login}>
                        <img src={a.avatar_url} alt={a.login} className="h-5 w-5 rounded-full border border-gray-200 dark:border-gray-700" />
                      </a>
                    ))}
                  </div>
                )}
                {issue.milestone && (
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    📍 {issue.milestone.title}
                  </span>
                )}
              </div>
            )}

            {/* Description */}
            <div className="rounded-lg border border-gray-200 dark:border-gray-700">
              <div className="flex items-center gap-2 border-b border-gray-200 bg-gray-50 px-4 py-2 dark:border-gray-700 dark:bg-gray-800/50">
                <img src={issue.user.avatar_url} alt={issue.user.login} className="h-5 w-5 rounded-full" />
                <span className="text-xs font-medium text-gray-700 dark:text-gray-300">{issue.user.login}</span>
                <span className="text-xs text-gray-400">commented {openedAgo}</span>
              </div>
              <div className="px-4 py-3">
                {issue.body ? (
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                    {issue.body}
                  </ReactMarkdown>
                ) : (
                  <p className="text-sm italic text-gray-400 dark:text-gray-500">No description provided.</p>
                )}
              </div>
            </div>

            {/* Comments */}
            {loadingComments ? (
              <div className="flex justify-center py-4">
                <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
              </div>
            ) : comments.length > 0 ? (
              <div className="space-y-3">
                <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">{comments.length} comment{comments.length > 1 ? 's' : ''}</h4>
                {comments.map(comment => (
                  <div key={comment.id} className="rounded-lg border border-gray-200 dark:border-gray-700">
                    <div className="flex items-center gap-2 border-b border-gray-200 bg-gray-50 px-4 py-2 dark:border-gray-700 dark:bg-gray-800/50">
                      <img src={comment.user.avatar_url} alt={comment.user.login} className="h-5 w-5 rounded-full" />
                      <span className="text-xs font-medium text-gray-700 dark:text-gray-300">{comment.user.login}</span>
                      <span className="text-xs text-gray-400">{timeAgo(comment.created_at)}</span>
                    </div>
                    <div className="px-4 py-3">
                      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                        {comment.body}
                      </ReactMarkdown>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        {/* Resize handle */}
        <div
          className="absolute bottom-0 right-0 h-4 w-4 cursor-se-resize"
          onMouseDown={onResizeMouseDown}
          style={{ touchAction: 'none' }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" className="text-gray-300 dark:text-gray-600">
            <path d="M14 2L2 14M14 8L8 14M14 14L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </div>
      </div>
    </div>
  );
}
