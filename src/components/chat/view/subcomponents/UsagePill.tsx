import { useCallback, useEffect, useRef, useState } from 'react';
import { BarChart2, RefreshCw } from 'lucide-react';
import { authenticatedFetch } from '../../../../utils/api';

type Bucket = {
  label: string;
  pct: number | null;
  reset_in?: string | null;
};

type UsageData = {
  plan?: string | null;
  session?: Bucket | null;
  weekly?: Bucket[];
  error?: string | null;
  cached?: boolean;
  fetchedAt?: string;
};

type UsagePillProps = {
  onOpenSettings?: () => void;
};

const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

function pctColor(pct: number): string {
  if (pct < 50) return 'text-blue-500 dark:text-blue-400';
  if (pct < 75) return 'text-amber-500 dark:text-amber-400';
  return 'text-red-500 dark:text-red-400';
}

export default function UsagePill({ onOpenSettings }: UsagePillProps) {
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [data, setData] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    authenticatedFetch('/api/user/claude-session-key')
      .then((r) => r.json() as Promise<{ success: boolean; hasKey: boolean }>)
      .then((body) => { if (body.success) setHasKey(body.hasKey); })
      .catch(() => setHasKey(false));
  }, []);

  const fetchUsage = useCallback(async (force = false) => {
    setLoading(true);
    try {
      const url = force ? '/api/usage/claude?refresh=1' : '/api/usage/claude';
      const res = await authenticatedFetch(url);
      const body = await res.json() as { success: boolean; hasSessionKey: boolean; data: UsageData | null };
      if (body.success) {
        setHasKey(body.hasSessionKey);
        if (body.hasSessionKey && body.data) setData(body.data);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!hasKey) return;
    void fetchUsage();
    intervalRef.current = setInterval(() => void fetchUsage(), REFRESH_INTERVAL_MS);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [hasKey, fetchUsage]);

  if (hasKey === null) return null;

  if (!hasKey) {
    if (!onOpenSettings) return null;
    return (
      <button
        type="button"
        onClick={onOpenSettings}
        title="Set up Claude.ai usage tracking"
        className="flex h-7 items-center gap-1 rounded-md border border-dashed border-border/50 px-2 text-xs text-muted-foreground/50 transition-colors hover:border-border hover:text-muted-foreground"
      >
        <BarChart2 className="h-3 w-3" />
        <span className="hidden sm:inline">Usage</span>
      </button>
    );
  }

  if (!data) {
    return (
      <div className="flex h-7 items-center px-1 text-xs text-muted-foreground/40">
        <RefreshCw className="h-3 w-3 animate-spin" />
      </div>
    );
  }

  const session = data.session;
  const allModels = data.weekly?.find((b) => b.label === 'All models');
  const sessionPct = session?.pct ?? null;
  const weeklyPct = allModels?.pct ?? null;
  const hasValues = sessionPct !== null || weeklyPct !== null;

  const tooltip = [
    session ? `Session: ${session.pct ?? '?'}%${session.reset_in ? ` (resets in ${session.reset_in})` : ''}` : null,
    allModels ? `Weekly: ${allModels.pct ?? '?'}%${allModels.reset_in ? ` (resets in ${allModels.reset_in})` : ''}` : null,
    data.plan ? `Plan: ${data.plan}` : null,
    data.error ? `Error: ${data.error}` : null,
  ].filter(Boolean).join('\n');

  return (
    <div className="flex items-center gap-0.5 text-xs">
      {data.error && !hasValues ? (
        <span title={data.error} className="cursor-help px-1 text-destructive">!</span>
      ) : hasValues ? (
        <span title={tooltip} className="flex cursor-default items-center gap-1 tabular-nums">
          {sessionPct !== null && (
            <span className={pctColor(sessionPct)}>{sessionPct}%</span>
          )}
          {sessionPct !== null && weeklyPct !== null && (
            <span className="text-muted-foreground/30">·</span>
          )}
          {weeklyPct !== null && (
            <span className={`${pctColor(weeklyPct)} text-muted-foreground/70`}>{weeklyPct}%</span>
          )}
        </span>
      ) : null}
      <button
        type="button"
        onClick={() => void fetchUsage(true)}
        disabled={loading}
        title="Refresh usage"
        className="rounded p-0.5 text-muted-foreground/40 transition-colors hover:text-muted-foreground disabled:opacity-30"
      >
        <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
      </button>
    </div>
  );
}
