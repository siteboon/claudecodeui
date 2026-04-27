import { useCallback, useEffect, useMemo, useState } from 'react';
import { authenticatedFetch } from '../../utils/api';
import type { Project } from '../../types/app';

type Ticket = {
  id: string;
  title: string;
  kind: string | null;
  status: string;
  deps: string[];
  env: string | null;
  created: string | null;
  updated: string | null;
  prUrl: string | null;
  worktreeBranch: string | null;
  request: string;
  log: string[];
};

type BoardPanelProps = {
  selectedProject: Project | null | undefined;
};

const COLUMNS: { key: string; label: string }[] = [
  { key: 'backlog', label: 'Backlog' },
  { key: 'ready', label: 'Ready' },
  { key: 'in-progress', label: 'In Progress' },
  { key: 'blocked', label: 'Blocked' },
  { key: 'done', label: 'Done' },
];

const POLL_MS = 3000;

const fetchWithAuth = authenticatedFetch as (url: string, options?: RequestInit) => Promise<Response>;

export default function BoardPanel({ selectedProject }: BoardPanelProps) {
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const projectName = selectedProject?.name ?? null;

  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (!projectName) return;
    try {
      const response = await fetchWithAuth(
        `/api/board?project=${encodeURIComponent(projectName)}`,
        { signal },
      );
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `HTTP ${response.status}`);
      }
      const data = await response.json();
      setTickets(Array.isArray(data.tickets) ? data.tickets : []);
      setError(null);
    } catch (err) {
      if ((err as { name?: string }).name === 'AbortError') return;
      setError((err as Error).message);
    }
  }, [projectName]);

  useEffect(() => {
    if (!projectName) return;
    const ctrl = new AbortController();
    void refresh(ctrl.signal);
    const timer = window.setInterval(() => {
      void refresh();
    }, POLL_MS);
    return () => {
      ctrl.abort();
      window.clearInterval(timer);
    };
  }, [projectName, refresh]);

  const grouped = useMemo(() => {
    const map: Record<string, Ticket[]> = {};
    for (const col of COLUMNS) map[col.key] = [];
    if (!tickets) return map;
    for (const t of tickets) {
      const bucket = map[t.status] ?? (map[t.status] = []);
      bucket.push(t);
    }
    return map;
  }, [tickets]);

  if (!selectedProject) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <p>Select a project to view the kanban board</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <h2 className="text-sm font-medium text-foreground">Kanban</h2>
        <div className="text-xs text-muted-foreground">
          {tickets ? `${tickets.length} tickets` : 'Loading…'}
        </div>
      </div>

      {error && (
        <div className="border-b border-border bg-destructive/10 px-4 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-3">
        {COLUMNS.map((col) => {
          const items = grouped[col.key] ?? [];
          return (
            <div
              key={col.key}
              className="flex w-72 shrink-0 flex-col rounded-md border border-border bg-muted/20"
            >
              <div className="flex items-center justify-between border-b border-border px-3 py-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {col.label}
                </span>
                <span className="text-xs text-muted-foreground">{items.length}</span>
              </div>
              <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
                {items.length === 0 ? (
                  <div className="px-1 py-2 text-xs text-muted-foreground/70">—</div>
                ) : (
                  items.map((t) => <TicketCard key={t.id} ticket={t} />)
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TicketCard({ ticket }: { ticket: Ticket }) {
  return (
    <div className="rounded border border-border bg-card p-2 text-xs shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] text-muted-foreground">{ticket.id}</span>
        {ticket.kind && (
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">
            {ticket.kind}
          </span>
        )}
      </div>
      <div className="mt-1 text-sm text-foreground">{ticket.title || ticket.request.slice(0, 80)}</div>
      {ticket.deps.length > 0 && (
        <div className="mt-1 text-[10px] text-muted-foreground">
          deps: {ticket.deps.join(', ')}
        </div>
      )}
      {ticket.prUrl && (
        <a
          href={ticket.prUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-1 block truncate text-[10px] text-primary hover:underline"
        >
          {ticket.prUrl}
        </a>
      )}
    </div>
  );
}
