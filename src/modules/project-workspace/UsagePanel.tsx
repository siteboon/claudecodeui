import { useCallback, useEffect, useState } from 'react';
import { Activity, AlertCircle, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { api } from '@/shared/api';

/**
 * One quota window agy reports for a group of models, normalized by the server
 * from agy's `/usage` command.
 */
type UsageBucket = {
  id: string;
  name: string;
  window: string;
  remainingFraction: number;
  resetTime: string | null;
  description: string | null;
};

/** One group of models that share the same quota windows. */
type UsageGroup = {
  name: string;
  description: string | null;
  buckets: UsageBucket[];
};

type Totals = {
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  turns: number;
};

type UsageSlice = {
  label: string;
  totalTokens: number;
  turns: number;
};

/** Everything `GET /api/providers/antigravity/usage` returns. */
type UsagePayload = {
  plan: { groups: UsageGroup[]; error: string | null };
  local: {
    totals: Totals;
    daily: Array<{ date: string; totalTokens: number }>;
    byModel: UsageSlice[];
    byProject: UsageSlice[];
    sessions: number;
  };
};

const formatTokens = (value: number): string => {
  if (!Number.isFinite(value) || value <= 0) {
    return '0';
  }
  if (value >= 999_500) {
    return `${(value / 1_000_000).toFixed(value >= 9_950_000 ? 0 : 1)}M`;
  }
  if (value >= 9_950) {
    return `${Math.round(value / 1_000)}K`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }
  return value.toLocaleString();
};

const formatResetTime = (value: string | null): string | null => {
  if (!value) {
    return null;
  }
  const stamp = Date.parse(value);
  if (!Number.isFinite(stamp)) {
    return null;
  }
  return new Date(stamp).toLocaleString();
};

/**
 * Rendered by the project-workspace module as its Usage tab: Antigravity's
 * account limits (from agy's own `/usage`) plus the token totals this app has
 * recorded for its turns.
 */
export default function UsagePanel() {
  const { t } = useTranslation();
  const [payload, setPayload] = useState<UsagePayload | null>(null);
  // Distinguishes "not loaded yet" from "loaded and empty", which the empty
  // state needs before it can claim there is no data.
  const [loading, setLoading] = useState(true);
  // The request-level failure (the endpoint being unreachable), kept apart from
  // `payload.plan.error`, which is agy's own "not signed in" style message.
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.providers.antigravityUsage();
      if (!response.ok) {
        throw new Error(`Usage request failed (${response.status})`);
      }
      const body = (await response.json()) as { data?: UsagePayload };
      setPayload(body.data ?? null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const daily = payload?.local.daily ?? [];
  const dailyMax = daily.reduce((max, entry) => Math.max(max, entry.totalTokens), 0);

  return (
    <div className="h-full overflow-y-auto px-4 py-5 sm:px-6">
      <div className="mx-auto flex max-w-5xl flex-col gap-5">
        <header className="flex items-start justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-lg font-semibold text-foreground">
              <Activity className="h-4 w-4 text-muted-foreground" />
              {t('tabs.usage', { defaultValue: 'Usage' })}
            </h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {t('usage.subtitle', {
                defaultValue: 'Antigravity plan limits and the tokens this server has recorded',
              })}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border/70 bg-background px-2.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
            disabled={loading}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            {t('common:refresh', { defaultValue: 'Refresh' })}
          </button>
        </header>

        {error && (
          <div className="flex items-start gap-2 rounded-xl border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-sm text-rose-700 dark:text-rose-300">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <section className="rounded-2xl border border-border/60 bg-card p-4">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-sm font-medium text-foreground">
              {t('usage.planLimits', { defaultValue: 'Plan limits' })}
            </h2>
            <span className="text-xs text-muted-foreground">
              {t('usage.fromAgy', { defaultValue: 'from agy /usage' })}
            </span>
          </div>

          {loading && !payload && (
            <p className="text-sm text-muted-foreground">{t('usage.loading', { defaultValue: 'Loading…' })}</p>
          )}

          {payload?.plan.error && (
            <p className="text-sm text-amber-600 dark:text-amber-400">{payload.plan.error}</p>
          )}

          {payload && !payload.plan.error && payload.plan.groups.length === 0 && (
            <p className="text-sm text-muted-foreground">
              {t('usage.noPlanData', { defaultValue: 'agy reported no quota data for this account.' })}
            </p>
          )}

          <div className="flex flex-col gap-4">
            {(payload?.plan.groups ?? []).map((group) => (
              <div key={group.name}>
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {group.name}
                </div>
                <div className="mt-2 flex flex-col gap-2.5">
                  {group.buckets.map((bucket) => {
                    const percent = Math.round(bucket.remainingFraction * 1000) / 10;
                    const reset = formatResetTime(bucket.resetTime);
                    return (
                      <div key={bucket.id}>
                        <div className="flex items-baseline justify-between text-sm">
                          <span className="text-foreground">{bucket.name}</span>
                          <span className="text-muted-foreground">
                            {percent}%
                            {reset ? ` · ${t('usage.resets', { defaultValue: 'resets' })} ${reset}` : ''}
                          </span>
                        </div>
                        <div
                          className="mt-1 h-2 w-full overflow-hidden rounded-full bg-muted"
                          role="progressbar"
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={percent}
                          aria-label={bucket.name}
                        >
                          <div
                            className={`h-full rounded-full ${
                              percent > 30 ? 'bg-emerald-500' : percent > 10 ? 'bg-amber-500' : 'bg-rose-500'
                            }`}
                            style={{ width: `${Math.max(0, Math.min(100, percent))}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            { label: t('usage.totalTokens', { defaultValue: 'Total tokens' }), value: formatTokens(payload?.local.totals.totalTokens ?? 0) },
            { label: t('usage.outputTokens', { defaultValue: 'Output tokens' }), value: formatTokens(payload?.local.totals.outputTokens ?? 0) },
            { label: t('usage.turns', { defaultValue: 'Turns' }), value: String(payload?.local.totals.turns ?? 0) },
            { label: t('usage.sessions', { defaultValue: 'Sessions' }), value: String(payload?.local.sessions ?? 0) },
          ].map((tile) => (
            <div key={tile.label} className="rounded-2xl border border-border/60 bg-card px-4 py-3">
              <div className="text-xl font-semibold text-foreground">{tile.value}</div>
              <div className="mt-0.5 text-[11px] uppercase tracking-wide text-muted-foreground">{tile.label}</div>
            </div>
          ))}
        </section>

        <section className="rounded-2xl border border-border/60 bg-card p-4">
          <h2 className="text-sm font-medium text-foreground">
            {t('usage.daily', { defaultValue: 'Daily tokens (30 days)' })}
          </h2>
          {daily.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">
              {t('usage.noLocalData', { defaultValue: 'No turns recorded yet.' })}
            </p>
          ) : (
            <div className="mt-3 flex h-32 items-end gap-1">
              {daily.map((entry) => (
                <div
                  key={entry.date}
                  className="flex-1 rounded-t bg-primary/70"
                  style={{ height: `${dailyMax > 0 ? Math.max(2, (entry.totalTokens / dailyMax) * 100) : 2}%` }}
                  title={`${entry.date}: ${formatTokens(entry.totalTokens)}`}
                />
              ))}
            </div>
          )}
        </section>

        <div className="grid gap-3 lg:grid-cols-2">
          {[
            { title: t('usage.byModel', { defaultValue: 'By model' }), rows: payload?.local.byModel ?? [] },
            { title: t('usage.byProject', { defaultValue: 'By project' }), rows: payload?.local.byProject ?? [] },
          ].map((section) => (
            <section key={section.title} className="rounded-2xl border border-border/60 bg-card p-4">
              <h2 className="text-sm font-medium text-foreground">{section.title}</h2>
              {section.rows.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">—</p>
              ) : (
                <ul className="mt-2 flex flex-col gap-1.5">
                  {section.rows.map((row) => (
                    <li key={row.label} className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="truncate text-foreground" title={row.label}>{row.label}</span>
                      <span className="flex-shrink-0 text-muted-foreground">
                        {formatTokens(row.totalTokens)} · {row.turns}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
