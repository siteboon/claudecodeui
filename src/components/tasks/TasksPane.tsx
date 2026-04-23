import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Circle, Clock, RefreshCw } from 'lucide-react';

import TaskCard, { type TaskCardData } from './TaskCard';

type TasksResponse = {
  projectName: string;
  sessionId: string;
  updatedAt: string | null;
  columns: {
    todo: TaskCardData[];
    in_progress: TaskCardData[];
    completed: TaskCardData[];
  };
  total: number;
};

type Props = {
  projectName?: string | null;
  sessionId?: string | null;
  /** pass through the accent for the active section (defaults to lavender) */
  accent?: 'mint' | 'sky' | 'lavender' | 'butter' | 'blush' | 'peach';
  /** optional WebSocket for live refresh triggers (from the chat stream) */
  ws?: WebSocket | null;
  /** when true, renders the swipeable single-column mobile layout */
  isMobile?: boolean;
  className?: string;
};

const POLL_INTERVAL_MS = 4000;

type ColumnKey = 'todo' | 'in_progress' | 'completed';
const COLUMNS: Array<{ key: ColumnKey; label: string; icon: typeof Circle }> = [
  { key: 'todo',        label: 'To-do',       icon: Circle },
  { key: 'in_progress', label: 'In progress', icon: Clock },
  { key: 'completed',   label: 'Done',        icon: CheckCircle2 },
];

async function fetchTasks(projectName: string, sessionId: string): Promise<TasksResponse | null> {
  const token = localStorage.getItem('auth-token');
  const url = `/api/tasks?projectName=${encodeURIComponent(projectName)}&sessionId=${encodeURIComponent(sessionId)}`;
  try {
    const res = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (!res.ok) return null;
    return (await res.json()) as TasksResponse;
  } catch {
    return null;
  }
}

export default function TasksPane({
  projectName,
  sessionId,
  accent = 'lavender',
  ws,
  isMobile = false,
  className = '',
}: Props) {
  const [data, setData] = useState<TasksResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [column, setColumn] = useState<ColumnKey>('todo');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const touchStartX = useRef<number | null>(null);

  const reload = useCallback(async () => {
    if (!projectName || !sessionId) {
      setData(null);
      return;
    }
    setLoading(true);
    const result = await fetchTasks(projectName, sessionId);
    setData(result);
    setLoading(false);
  }, [projectName, sessionId]);

  useEffect(() => {
    void reload();
    if (pollRef.current) clearInterval(pollRef.current);
    if (projectName && sessionId) {
      pollRef.current = setInterval(() => { void reload(); }, POLL_INTERVAL_MS);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [projectName, sessionId, reload]);

  // Listen for any message on the chat WS that could indicate tools changed.
  useEffect(() => {
    if (!ws) return;
    const onMsg = (event: MessageEvent) => {
      try {
        const payload = JSON.parse(typeof event.data === 'string' ? event.data : '');
        const name = payload?.tool?.name || payload?.message?.tool_name || '';
        if (name === 'TodoWrite') {
          void reload();
        }
      } catch { /* ignore */ }
    };
    ws.addEventListener('message', onMsg);
    return () => ws.removeEventListener('message', onMsg);
  }, [ws, reload]);

  const columns = useMemo(() => ({
    todo: data?.columns.todo || [],
    in_progress: data?.columns.in_progress || [],
    completed: data?.columns.completed || [],
  }), [data]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0]?.clientX ?? null;
  }, []);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (touchStartX.current == null) return;
    const dx = (e.changedTouches[0]?.clientX ?? 0) - touchStartX.current;
    touchStartX.current = null;
    if (Math.abs(dx) < 60) return;
    setColumn((prev) => {
      const idx = COLUMNS.findIndex((c) => c.key === prev);
      const nextIdx = dx < 0 ? Math.min(idx + 1, COLUMNS.length - 1) : Math.max(idx - 1, 0);
      return COLUMNS[nextIdx].key;
    });
  }, []);

  const totalEmpty = !loading && data && data.total === 0;

  return (
    <div
      data-accent={accent}
      className={`flex h-full min-h-0 w-full flex-col overflow-hidden ${className}`.trim()}
    >
      <div
        className="flex items-center justify-between gap-2 border-b border-midnight-border px-3 py-2"
        style={{ background: 'var(--midnight-surface-1)' }}
      >
        <div className="text-sm font-semibold text-midnight-text">Tasks</div>
        <div className="flex items-center gap-2">
          {data?.updatedAt && (
            <span className="text-xs tabular-nums text-midnight-text3">
              {new Date(data.updatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
            </span>
          )}
          <button
            type="button"
            aria-label="Refresh tasks"
            onClick={reload}
            className="btn btn-ghost mobile-touch-target"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          </button>
        </div>
      </div>

      {isMobile ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="ds-segment mx-3 my-2 self-stretch">
            {COLUMNS.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                className={`ds-segment-item ${column === key ? 'ds-segment-item-active' : ''}`}
                onClick={() => setColumn(key)}
                aria-pressed={column === key}
              >
                <span>{label}</span>
                <span className="ml-1 tabular-nums text-midnight-text3">({columns[key].length})</span>
              </button>
            ))}
          </div>
          <div
            className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 pb-4"
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
          >
            {columns[column].length === 0 ? (
              <EmptyColumn label={COLUMNS.find((c) => c.key === column)?.label || ''} />
            ) : (
              columns[column].map((task, idx) => (
                <TaskCard key={`${column}-${idx}`} task={task} accent={accent} updatedAt={data?.updatedAt} />
              ))
            )}
          </div>
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-hidden p-3 md:grid-cols-3">
          {COLUMNS.map(({ key, label, icon: Icon }) => (
            <section
              key={key}
              className="flex min-h-0 flex-col gap-2 overflow-hidden"
            >
              <header className="flex items-center justify-between px-1">
                <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-midnight-text2">
                  <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>{label}</span>
                </div>
                <span className="badge badge-lavender tabular-nums">{columns[key].length}</span>
              </header>
              <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
                {columns[key].length === 0 ? (
                  <EmptyColumn label={label} />
                ) : (
                  columns[key].map((task, idx) => (
                    <TaskCard key={`${key}-${idx}`} task={task} accent={accent} updatedAt={data?.updatedAt} />
                  ))
                )}
              </div>
            </section>
          ))}
        </div>
      )}

      {totalEmpty && (
        <div className="px-3 pb-4 text-xs text-midnight-text3">
          No TodoWrite output found for this session yet.
        </div>
      )}
    </div>
  );
}

function EmptyColumn({ label }: { label: string }) {
  return (
    <div className="ds-tile-plain flex h-24 items-center justify-center text-xs text-midnight-text3">
      No {label.toLowerCase()} tasks
    </div>
  );
}
