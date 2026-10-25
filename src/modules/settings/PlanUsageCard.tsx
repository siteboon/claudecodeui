import { Gauge, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { usePlanUsage } from '@/modules/settings/hooks/usePlanUsage';

type PlanUsageCardProps = { provider: 'claude' | 'codex' };

const barColor = (percent: number) => {
  if (percent >= 95) return 'bg-red-500';
  if (percent >= 80) return 'bg-amber-500';
  return 'bg-primary';
};

function UsageBar({ label, utilization, resetsAt, withDay }: {
  label: string;
  utilization: number | null;
  resetsAt: string | null;
  withDay: boolean;
}) {
  const { t } = useTranslation('sidebar');
  const percent = utilization == null ? null : Math.max(0, Math.min(100, Math.round(utilization)));
  const resetDate = resetsAt ? new Date(resetsAt) : null;
  const resetTime = resetDate && !Number.isNaN(resetDate.getTime())
    ? resetDate.toLocaleString([], withDay
      ? { weekday: 'short', hour: 'numeric', minute: '2-digit' }
      : { hour: 'numeric', minute: '2-digit' })
    : null;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="tabular-nums text-foreground">{percent == null ? '–' : `${percent}%`}</span>
      </div>
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
        <div className={`h-full rounded-full ${percent == null ? '' : barColor(percent)}`} style={{ width: `${percent ?? 0}%` }} />
      </div>
      {resetTime && <p className="mt-1 text-xs text-muted-foreground">{t('usage.resets', { defaultValue: 'Resets {{time}}', time: resetTime })}</p>}
    </div>
  );
}

/** Rendered by AccountContent for Claude and Codex account plan limits. */
export default function PlanUsageCard({ provider }: PlanUsageCardProps) {
  const { t } = useTranslation('sidebar');
  const { usage, loading, error, refresh } = usePlanUsage(provider);

  return (
    <section className="rounded-lg border border-border bg-card p-4" aria-label={`${provider} ${t('usage.title', { defaultValue: 'Usage' })}`}>
      <div className="mb-5 flex items-center justify-between gap-3">
        <h4 className="flex items-center gap-2 font-medium text-foreground">
          <Gauge className="h-4 w-4 text-muted-foreground" />
          {t('usage.title', { defaultValue: 'Usage' })}
        </h4>
        <button
          type="button"
          onClick={() => { void refresh(); }}
          disabled={loading}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
          aria-label={t('usage.refresh', { defaultValue: 'Click to refresh' })}
          title={t('usage.refresh', { defaultValue: 'Click to refresh' })}
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>
      {error && !usage ? (
        <p className="text-sm text-muted-foreground">{t('usage.loadError', { defaultValue: 'Could not load usage. Try refreshing.' })}</p>
      ) : usage && !usage.available ? (
        <p className="text-sm text-muted-foreground">{t('usage.unavailable', { defaultValue: 'No plan limits for this login' })}</p>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2">
          <UsageBar label={t('usage.fiveHour', { defaultValue: '5-hour' })} utilization={usage?.fiveHour?.utilization ?? null} resetsAt={usage?.fiveHour?.resetsAt ?? null} withDay={false} />
          <UsageBar label={t('usage.week', { defaultValue: 'Week' })} utilization={usage?.sevenDay?.utilization ?? null} resetsAt={usage?.sevenDay?.resetsAt ?? null} withDay />
        </div>
      )}
    </section>
  );
}
