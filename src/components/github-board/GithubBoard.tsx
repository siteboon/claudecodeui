import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, ExternalLink, Github, Loader2, RefreshCw, Settings, Sparkles, ChevronDown } from 'lucide-react';
import { cn } from '../../lib/utils';
import { api } from '../../utils/api';
import { useTaskMaster } from '../task-master/context/TaskMasterContext';
import GitHubSyncModal from '../task-master/view/modals/GitHubSyncModal';
import GithubIssueModal from './GithubIssueModal';
import GithubKanbanColumn from './GithubKanbanColumn';
import type { GithubColumn, GithubIssue, IssuePriority } from './types';
import { getIssuePriority, PRIORITY_CONFIG } from './types';

type IssuesData = {
  issues: GithubIssue[];
  owner: string;
  repo: string;
  columns: GithubColumn[];
};

type SortKey = 'updated' | 'created' | 'priority' | 'comments';

const PRIORITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2, '': 3 };

const POLL_INTERVAL = 60_000;

export default function GithubBoard() {
  const { currentProject } = useTaskMaster();
  const [data, setData] = useState<IssuesData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notConfigured, setNotConfigured] = useState(false);
  const [selectedIssue, setSelectedIssue] = useState<GithubIssue | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  // Filter + sort state
  const [filterPriority, setFilterPriority] = useState<IssuePriority | 'all'>('all');
  const [sortKey, setSortKey] = useState<SortKey>('updated');
  const [sortAsc, setSortAsc] = useState(false);
  const [search, setSearch] = useState('');
  const [showSortMenu, setShowSortMenu] = useState(false);

  // AI prioritize state
  const [aiLoading, setAiLoading] = useState(false);
  const [aiToast, setAiToast] = useState<string | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const projectId = currentProject?.projectId;

  const fetchIssues = useCallback(async (silent = false) => {
    if (!projectId) return;
    if (!silent) setLoading(true);
    setError(null);

    try {
      const r = await api.github.getIssues(projectId);
      if (r.status === 500) {
        const d = await r.json() as { error?: string };
        if (d.error?.includes('not configured')) { setNotConfigured(true); return; }
        throw new Error(d.error || 'Failed to load issues');
      }
      const d = await r.json() as IssuesData;
      setNotConfigured(false);

      const columns: GithubColumn[] = d.columns || [];
      const issues = d.issues.map(issue => {
        const labelNames = (issue.labels || []).map(l => l.name);
        if (issue.state === 'closed') return { ...issue, columnId: 'done' };
        for (const col of columns) {
          if (col.labels.length > 0 && col.labels.some(l => labelNames.includes(l))) {
            return { ...issue, columnId: col.id };
          }
        }
        return { ...issue, columnId: 'todo' };
      });
      setData({ ...d, issues, columns });
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void fetchIssues();
    pollRef.current = setInterval(() => { void fetchIssues(true); }, POLL_INTERVAL);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [fetchIssues]);

  const handleStatusChange = (issue: GithubIssue, toColumnId: string) => {
    if (!data) return;
    setData(prev => {
      if (!prev) return prev;
      return { ...prev, issues: prev.issues.map(i => i.number === issue.number ? { ...i, columnId: toColumnId } : i) };
    });
  };

  const handleAIPrioritize = async () => {
    if (!data || !projectId || aiLoading) return;
    setAiLoading(true);
    try {
      const openIssues = data.issues.filter(i => i.state !== 'closed');
      const r = await api.github.prioritizeIssues(projectId, openIssues.map(i => ({
        number: i.number,
        title: i.title,
        body: i.body,
        labels: i.labels,
        state: i.state,
      })));
      const result = await r.json() as { priorities?: { number: number; priority: string; reason: string }[]; error?: string };
      if (result.error) throw new Error(result.error);

      // Apply priority labels via updateIssue calls
      const PRIORITY_LABELS = ['priority:high', 'priority:medium', 'priority:low'];
      const updates = result.priorities || [];
      await Promise.all(updates.map(async ({ number, priority }) => {
        const issue = data.issues.find(i => i.number === number);
        if (!issue) return;
        const filtered = issue.labels.map(l => l.name).filter(n => !PRIORITY_LABELS.includes(n));
        await api.github.updateIssue(projectId, number, { labels: [...filtered, `priority:${priority}`] });
      }));

      setAiToast(`AI set priorities on ${updates.length} issues`);
      setTimeout(() => setAiToast(null), 4000);
      void fetchIssues(true);
    } catch (e: unknown) {
      setAiToast(`Error: ${(e as Error).message}`);
      setTimeout(() => setAiToast(null), 5000);
    } finally {
      setAiLoading(false);
    }
  };

  const sortFn = useCallback((a: GithubIssue, b: GithubIssue): number => {
    let cmp = 0;
    if (sortKey === 'priority') {
      const pa = getIssuePriority(a) ?? '';
      const pb = getIssuePriority(b) ?? '';
      cmp = (PRIORITY_ORDER[pa] ?? 3) - (PRIORITY_ORDER[pb] ?? 3);
    } else if (sortKey === 'comments') {
      cmp = a.comments - b.comments;
    } else if (sortKey === 'created') {
      cmp = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    } else {
      cmp = new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime();
    }
    return sortAsc ? cmp : -cmp;
  }, [sortKey, sortAsc]);

  if (loading) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>;
  }

  if (notConfigured || (!loading && !data && !error)) {
    return (
      <>
        <div className="flex h-64 flex-col items-center justify-center gap-4 text-center">
          <Github className="h-12 w-12 text-gray-300 dark:text-gray-600" />
          <div>
            <h3 className="text-base font-semibold text-gray-700 dark:text-gray-300">GitHub not connected</h3>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Connect a GitHub repo to see Issues here</p>
          </div>
          <button onClick={() => setShowSettings(true)}
            className="flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm text-white hover:bg-gray-700 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100">
            <Github className="h-4 w-4" />Connect GitHub Repository
          </button>
        </div>
        <GitHubSyncModal isOpen={showSettings} project={currentProject} onClose={() => { setShowSettings(false); void fetchIssues(); }} />
      </>
    );
  }

  if (error) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-3 text-center">
        <AlertCircle className="h-8 w-8 text-red-400" />
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        <button onClick={() => void fetchIssues()} className="text-sm text-blue-500 hover:underline">Retry</button>
      </div>
    );
  }

  if (!data) return null;

  // Filter
  const filteredIssues = data.issues.filter(issue => {
    if (filterPriority !== 'all' && getIssuePriority(issue) !== filterPriority) return false;
    if (search && !issue.title.toLowerCase().includes(search.toLowerCase()) && !String(issue.number).includes(search)) return false;
    return true;
  });

  // Only show columns that have matching issues
  const visibleColumns = data.columns.filter(col => filteredIssues.some(i => i.columnId === col.id));
  const columnCount = visibleColumns.length || 1;

  const SORT_LABELS: Record<SortKey, string> = { updated: 'Updated', created: 'Created', priority: 'Priority', comments: 'Comments' };

  return (
    <>
      {/* Header */}
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Github className="h-4 w-4 text-gray-500 dark:text-gray-400" />
          <a href={`https://github.com/${data.owner}/${data.repo}/issues`} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1 text-sm font-medium text-gray-700 hover:text-blue-500 dark:text-gray-300">
            {data.owner}/{data.repo}<ExternalLink className="h-3 w-3" />
          </a>
          <span className="text-xs text-gray-400 dark:text-gray-500">· {filteredIssues.length}/{data.issues.length}</span>
        </div>
        <div className="flex items-center gap-1.5">
          {/* AI Prioritize */}
          <button
            onClick={() => { void handleAIPrioritize(); }}
            disabled={aiLoading}
            className="flex items-center gap-1.5 rounded-md bg-violet-50 px-2.5 py-1.5 text-xs font-medium text-violet-700 hover:bg-violet-100 dark:bg-violet-900/20 dark:text-violet-400 dark:hover:bg-violet-900/30 disabled:opacity-50"
            title="Let AI suggest priorities for all open issues"
          >
            {aiLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            AI Prioritize
          </button>
          <button onClick={() => void fetchIssues()}
            className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300" title="Refresh">
            <RefreshCw className="h-4 w-4" />
          </button>
          <button onClick={() => setShowSettings(true)}
            className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300" title="Settings">
            <Settings className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Filter + sort toolbar */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {/* Search */}
        <input
          type="text"
          placeholder="Search issues…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="h-7 rounded-md border border-gray-200 bg-white px-2.5 text-xs text-gray-700 placeholder-gray-400 focus:border-blue-300 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
          style={{ width: 160 }}
        />

        {/* Priority filter */}
        <div className="flex items-center gap-1">
          {(['all', 'high', 'medium', 'low'] as const).map(p => (
            <button
              key={p}
              onClick={() => setFilterPriority(p)}
              className={cn(
                'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors',
                filterPriority === p
                  ? p === 'all'
                    ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
                    : PRIORITY_CONFIG[p].badge + ' ring-1 ring-current'
                  : 'bg-gray-100 text-gray-500 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700'
              )}
            >
              {p !== 'all' && <span className={cn('h-1.5 w-1.5 rounded-full', PRIORITY_CONFIG[p].dot)} />}
              {p === 'all' ? 'All' : PRIORITY_CONFIG[p].label}
            </button>
          ))}
        </div>

        {/* Sort */}
        <div className="relative ml-auto flex items-center gap-1">
          <button
            onClick={() => setSortAsc(v => !v)}
            className="flex h-7 w-7 items-center justify-center rounded-md border border-gray-200 bg-white text-sm text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400"
            title={sortAsc ? 'Ascending — click to switch to descending' : 'Descending — click to switch to ascending'}
          >
            {sortAsc ? '↑' : '↓'}
          </button>
          <button
            onClick={() => setShowSortMenu(v => !v)}
            className="flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400"
          >
            Sort: {SORT_LABELS[sortKey]}
            <ChevronDown className="h-3 w-3" />
          </button>
          {showSortMenu && (
            <div className="absolute right-0 top-full z-20 mt-1 w-40 rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-800">
              {(['updated', 'created', 'priority', 'comments'] as SortKey[]).map(k => (
                <button key={k}
                  onClick={() => {
                    if (sortKey === k) setSortAsc(v => !v);
                    else { setSortKey(k); setSortAsc(false); }
                    setShowSortMenu(false);
                  }}
                  className={cn(
                    'w-full px-3 py-1.5 text-left text-xs transition-colors',
                    sortKey === k ? 'bg-blue-50 font-medium text-blue-700 dark:bg-blue-900/20 dark:text-blue-300' : 'text-gray-600 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-700/50'
                  )}
                >
                  {SORT_LABELS[k]} {sortKey === k ? (sortAsc ? '↑' : '↓') : ''}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Kanban */}
      <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))` }}
        onClick={() => setShowSortMenu(false)}>
        {visibleColumns.map(col => (
          <GithubKanbanColumn
            key={col.id}
            column={col}
            issues={filteredIssues.filter(i => i.columnId === col.id).sort(sortFn)}
            onIssueClick={setSelectedIssue}
          />
        ))}
      </div>

      {/* Issue modal */}
      <GithubIssueModal
        issue={selectedIssue}
        isOpen={selectedIssue !== null}
        projectId={projectId ?? ''}
        columns={data.columns}
        onClose={() => setSelectedIssue(null)}
        onStatusChange={(issue, toColumnId) => { handleStatusChange(issue, toColumnId); setSelectedIssue(null); }}
      />

      {/* Settings modal */}
      <GitHubSyncModal isOpen={showSettings} project={currentProject} onClose={() => { setShowSettings(false); void fetchIssues(); }} />

      {/* AI toast */}
      {aiToast && (
        <div className="animate-in slide-in-from-bottom-2 fixed bottom-4 right-4 z-50 duration-300">
          <div className="flex items-center gap-3 rounded-lg bg-violet-600 px-4 py-3 text-white shadow-lg">
            <Sparkles className="h-4 w-4 shrink-0" />
            <span className="text-sm font-medium">{aiToast}</span>
          </div>
        </div>
      )}
    </>
  );
}
