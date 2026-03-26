import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, BarChart3, Loader2, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../../../../utils/api';

type RateLimitPeriod = {
  utilization: number | null;
  percent: number | null;
  resetText: string;
  status: string | null;
};

type RateLimits = {
  session: RateLimitPeriod;
  weekly: RateLimitPeriod;
};

type UsageData = {
  plan: string | null;
  rateLimitTier: string | null;
  rateLimits: RateLimits | null;
};

function barColor(pct: number): string {
  if (pct >= 90) return 'bg-red-500';
  if (pct >= 70) return 'bg-amber-500';
  return 'bg-blue-600 dark:bg-blue-500';
}

function RateLimitMeter({ label, period }: { label: string; period: RateLimitPeriod }) {
  if (period.percent === null) return null;
  const pct = Math.min(period.percent, 100);
  return (
    <div className="space-y-2 rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-foreground">{label}</span>
        <span className="text-sm text-muted-foreground">{period.percent}% used</span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full transition-all ${barColor(period.percent)}`}
          style={{ width: `${Math.max(pct, 1)}%` }}
        />
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{period.resetText}</span>
        {period.status && period.status !== 'allowed' && (
          <span className="font-medium text-amber-600 dark:text-amber-400">{period.status}</span>
        )}
      </div>
    </div>
  );
}

export default function UsageSettingsTab() {
  const { t } = useTranslation('settings');
  const [data, setData] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState('');

  const fetchUsage = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.usage.current();
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || `Server error (${res.status})`);
      }
      setData(await res.json());
      setLastUpdated(new Date().toLocaleTimeString());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load usage data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchUsage(); }, [fetchUsage]);

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-6">
        <Header />
        <div className="flex items-center gap-2 rounded-lg border border-border bg-card p-4 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          {error || 'Failed to load usage data'}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 md:space-y-8">
      <Header />

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-card p-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Plan badge */}
      {data.plan && (
        <div className="flex items-center gap-3">
          <span className="rounded-full bg-blue-100 px-3 py-1 text-sm font-medium text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
            Claude {data.plan}
          </span>
          {data.rateLimitTier && (
            <span className="text-xs text-muted-foreground">{data.rateLimitTier}</span>
          )}
        </div>
      )}

      {/* Real rate limits from Anthropic */}
      {data.rateLimits && (
        <div className="space-y-3">
          <h4 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            {t('usage.planLimits')}
          </h4>
          <RateLimitMeter
            label={t('usage.currentSession')}
            period={data.rateLimits.session}
          />
          <RateLimitMeter
            label={t('usage.weeklyAllModels')}
            period={data.rateLimits.weekly}
          />
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {t('usage.lastUpdated')}: {lastUpdated}
            </span>
            <button
              onClick={() => fetchUsage()}
              disabled={loading}
              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
              title={t('usage.refresh')}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Header() {
  const { t } = useTranslation('settings');
  return (
    <div className="flex items-center gap-3">
      <BarChart3 className="h-5 w-5 text-blue-600" />
      <h3 className="text-lg font-medium text-foreground">{t('usage.title')}</h3>
    </div>
  );
}
