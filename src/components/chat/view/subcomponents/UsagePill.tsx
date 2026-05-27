import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
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

function getColor(pct: number): string {
  if (pct < 50) return 'text-blue-500';
  if (pct < 75) return 'text-amber-500';
  return 'text-red-500';
}

export default function UsagePill({ onOpenSettings }: UsagePillProps) {
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [data, setData] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fast check: does the user have a session key configured?
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

  // Start fetching usage data once we know a key exists
  useEffect(() => {
    if (!hasKey) return;
    void fetchUsage();
    intervalRef.current = setInterval(() => void fetchUsage(), REFRESH_INTERVAL_MS);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [hasKey, fetchUsage]);

  // Not yet determined
  if (hasKey === null) return null;

  // No key configured
  if (!hasKey) {
    if (!onOpenSettings) return null;
    return (
      <button
        onClick={onOpenSettings}
        className="text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors whitespace-nowrap"
        title="Set up Claude.ai usage tracking"
      >
        Usage: set up
      </button>
    );
  }

  // Key exists but data still loading
  if (!data) {
    return (
      <div className="flex items-center gap-1 text-xs text-muted-foreground/50">
        <RefreshCw className="h-3 w-3 animate-spin" />
      </div>
    );
  }

  const session = data.session;
  const allModels = data.weekly?.find((b) => b.label === 'All models');
  const sessionPct = session?.pct ?? null;
  const weeklyPct = allModels?.pct ?? null;
  const hasValues = sessionPct !== null || weeklyPct !== null;

  const titleLines = [
    session ? `Session: ${session.pct ?? '?'}%${session.reset_in ? ` (resets in ${session.reset_in})` : ''}` : null,
    allModels ? `Weekly (all): ${allModels.pct ?? '?'}%${allModels.reset_in ? ` (resets in ${allModels.reset_in})` : ''}` : null,
    data.plan ? `Plan: ${data.plan}` : null,
    data.error ? `Error: ${data.error}` : null,
  ].filter(Boolean).join('\n');

  return (
    <div className="flex items-center gap-1 text-xs text-muted-foreground">
      {data.error && !hasValues ? (
        <span title={data.error} className="cursor-help text-destructive">!</span>
      ) : hasValues ? (
        <span title={titleLines} className="flex cursor-default items-center gap-1">
          {sessionPct !== null && (
            <span className={getColor(sessionPct)}>S{sessionPct}%</span>
          )}
          {sessionPct !== null && weeklyPct !== null && (
            <span className="text-muted-foreground/40">/</span>
          )}
          {weeklyPct !== null && (
            <span className={getColor(weeklyPct)}>W{weeklyPct}%</span>
          )}
        </span>
      ) : null}
      <button
        onClick={() => void fetchUsage(true)}
        disabled={loading}
        title="Refresh usage data"
        className="p-0.5 transition-colors hover:text-foreground disabled:opacity-50"
      >
        <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
      </button>
    </div>
  );
}
