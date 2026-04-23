import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, GitBranch, Loader2 } from 'lucide-react';

import { useSessionActivity } from '../../../contexts/SessionActivityContext';

export type Worktree = {
  path: string;
  branch: string | null;
  head?: string;
  isMain: boolean;
  locked: boolean;
  prunable: boolean;
  slug: string;
};

type WorktreeStatus = 'idle' | 'active' | 'waiting' | 'blocked';

type WorktreeListProps = {
  /** Absolute filesystem path to the parent repo. When absent, list is hidden. */
  repoPath?: string | null;
  /** Session IDs currently receiving messages (for green dot) */
  activeSessions?: Set<string>;
  /** Session IDs currently waiting on model (for yellow pulse) */
  processingSessions?: Set<string>;
  /** Session IDs currently blocked on permission (for red dot) */
  blockedSessions?: Set<string>;
  /** Map of worktree path → sessionId, allows dot color resolution */
  worktreeSessionMap?: Record<string, string>;
  onSelect?: (worktree: Worktree) => void;
};

async function fetchWorktrees(repoPath: string): Promise<Worktree[]> {
  const token = localStorage.getItem('auth-token');
  const res = await fetch(`/api/worktrees?repo=${encodeURIComponent(repoPath)}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!res.ok) return [];
  const body = (await res.json()) as { worktrees?: Worktree[] };
  return Array.isArray(body?.worktrees) ? body.worktrees : [];
}

async function createWorktree(repoPath: string, slug: string): Promise<Worktree | null> {
  const token = localStorage.getItem('auth-token');
  const res = await fetch('/api/worktrees', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ repo: repoPath, slug }),
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { worktree?: Worktree };
  return body?.worktree ?? null;
}

async function deleteWorktree(repoPath: string, worktreePath: string): Promise<boolean> {
  const token = localStorage.getItem('auth-token');
  const res = await fetch('/api/worktrees', {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ repo: repoPath, path: worktreePath }),
  });
  return res.ok;
}

async function spawnWorktreeSession(worktreePath: string): Promise<boolean> {
  const token = localStorage.getItem('auth-token');
  const res = await fetch('/api/worktrees/spawn', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ worktreePath }),
  });
  return res.ok;
}

function dotClass(status: WorktreeStatus): string {
  switch (status) {
    case 'active':  return 'bg-mint';
    case 'waiting': return 'bg-butter animate-pulse';
    case 'blocked': return 'bg-blush';
    default:        return 'bg-midnight-text3';
  }
}

function dotAria(status: WorktreeStatus): string {
  switch (status) {
    case 'active':  return 'Active';
    case 'waiting': return 'Waiting for model response';
    case 'blocked': return 'Blocked on permission';
    default:        return 'Idle';
  }
}

export default function WorktreeList({
  repoPath,
  activeSessions: activeSessionsProp,
  processingSessions: processingSessionsProp,
  blockedSessions: blockedSessionsProp,
  worktreeSessionMap: worktreeSessionMapProp,
  onSelect,
}: WorktreeListProps) {
  // Activity sets are normally piped through the SessionActivityProvider in
  // AppContent — SidebarProjectItem (parent of this list) is a no-edit churn
  // file per docs/CLAUDE.md, so the props can't be threaded through it.
  const ctx = useSessionActivity();
  const activeSessions = activeSessionsProp ?? ctx.activeSessions;
  const processingSessions = processingSessionsProp ?? ctx.processingSessions;
  const blockedSessions = blockedSessionsProp ?? ctx.blockedSessions;
  const worktreeSessionMap = worktreeSessionMapProp ?? ctx.worktreeSessionMap;

  const [worktrees, setWorktrees] = useState<Worktree[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [pendingPath, setPendingPath] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!repoPath) {
      setWorktrees([]);
      return;
    }
    setLoading(true);
    const list = await fetchWorktrees(repoPath);
    setWorktrees(list);
    setLoading(false);
  }, [repoPath]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const onCreate = useCallback(async () => {
    if (!repoPath) return;
    const suggestion = `wt-${new Date().toISOString().replace(/[^0-9]/g, '').slice(4, 12)}`;
    const slug = window.prompt('New worktree slug (letters/numbers/hyphens)', suggestion);
    if (!slug) return;
    setCreating(true);
    const wt = await createWorktree(repoPath, slug);
    setCreating(false);
    if (wt) {
      await reload();
      void spawnWorktreeSession(wt.path);
    }
  }, [repoPath, reload]);

  const onDelete = useCallback(async (worktreePath: string) => {
    if (!repoPath) return;
    const ok = window.confirm(`Remove worktree at ${worktreePath}?`);
    if (!ok) return;
    setPendingPath(worktreePath);
    const success = await deleteWorktree(repoPath, worktreePath);
    setPendingPath(null);
    if (success) await reload();
  }, [repoPath, reload]);

  const nonMain = useMemo(() => worktrees.filter((w) => !w.isMain), [worktrees]);

  if (!repoPath) return null;

  return (
    <div className="ml-3 space-y-1 border-l border-border pl-3">
      <div className="flex items-center justify-between px-1 pb-1 pt-1">
        <div className="flex items-center gap-1 text-[11px] uppercase tracking-wider text-midnight-text3">
          <GitBranch className="h-3 w-3" aria-hidden="true" />
          <span>Worktrees</span>
          {loading && <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />}
        </div>
        <button
          type="button"
          onClick={onCreate}
          aria-label="Create new worktree"
          disabled={creating}
          className="btn btn-ghost mobile-touch-target h-7 min-h-0 w-7 min-w-0 rounded-midnight-control p-0"
        >
          {creating ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          )}
        </button>
      </div>

      {nonMain.length === 0 && !loading ? (
        <div className="px-1 py-1 text-xs text-midnight-text3">No parallel worktrees</div>
      ) : (
        nonMain.map((wt) => {
          const sessionId = worktreeSessionMap[wt.path];
          const status: WorktreeStatus = (() => {
            if (!sessionId) return 'idle';
            if (blockedSessions?.has(sessionId)) return 'blocked';
            if (processingSessions?.has(sessionId)) return 'waiting';
            if (activeSessions?.has(sessionId)) return 'active';
            return 'idle';
          })();
          const isDeleting = pendingPath === wt.path;
          return (
            <div
              key={wt.path}
              className="group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent/40"
            >
              <button
                type="button"
                onClick={() => onSelect?.(wt)}
                className="mobile-touch-target flex min-w-0 flex-1 items-center gap-2 text-left"
                title={wt.path}
              >
                <span
                  className={`inline-block h-2 w-2 shrink-0 rounded-full ${dotClass(status)}`}
                  aria-label={dotAria(status)}
                  role="img"
                />
                <span className="truncate text-xs text-midnight-text">{wt.slug}</span>
                {wt.branch && (
                  <span className="ds-chip ds-chip-lavender ml-1 max-w-[9rem] shrink truncate !px-2 !py-0.5 text-[10px] uppercase tracking-wider">
                    {wt.branch}
                  </span>
                )}
              </button>
              <button
                type="button"
                onClick={() => onDelete(wt.path)}
                aria-label={`Remove worktree ${wt.slug}`}
                disabled={isDeleting}
                className="mobile-touch-target flex h-10 w-10 items-center justify-center rounded opacity-70 transition-opacity hover:opacity-100 focus-visible:opacity-100 md:opacity-0 md:group-hover:opacity-100"
              >
                {isDeleting ? (
                  <Loader2 className="h-3 w-3 animate-spin text-midnight-text3" aria-hidden="true" />
                ) : (
                  <Trash2 className="h-3 w-3 text-midnight-text3" aria-hidden="true" />
                )}
              </button>
            </div>
          );
        })
      )}
    </div>
  );
}
