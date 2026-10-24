import { Gauge } from 'lucide-react';
import type { TFunction } from 'i18next';

import { formatResetTime, usePlanUsage } from '@/modules/sidebar/hooks/usePlanUsage';
import type { PlanUsageWindow } from '@/modules/sidebar/hooks/usePlanUsage';

const barColor = (percent: number) => {
  if (percent >= 95) return 'bg-red-500';
  if (percent >= 80) return 'bg-amber-500';
  return 'bg-primary';
};

function UsageBar({ label, window, withDay, t }: {
  label: string;
  window: PlanUsageWindow | null;
  withDay: boolean;
  t: TFunction;
}) {
  const percent = window?.utilization == null ? null : Math.max(0, Math.min(100, Math.round(window.utilization)));
  const resets = formatResetTime(window?.resetsAt ?? null, withDay);

  return (
    <div className="mt-1.5">
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="tabular-nums text-foreground">{percent == null ? '–' : `${percent}%`}</span>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full ${percent == null ? '' : barColor(percent)}`}
          style={{ width: `${percent ?? 0}%` }}
        />
      </div>
      {resets && (
        <div className="mt-0.5 text-[10px] text-muted-foreground/70">
          {t('usage.resets', { defaultValue: 'Resets {{time}}', time: resets })}
        </div>
      )}
    </div>
  );
}

function UsageBody({ t, mobile }: { t: TFunction; mobile: boolean }) {
  const { usage, loading, refresh } = usePlanUsage();
  const title = t('usage.title', { defaultValue: 'Usage' });

  return (
    <button
      type="button"
      onClick={() => { void refresh(); }}
      title={t('usage.refresh', { defaultValue: 'Click to refresh' })}
      className={mobile
        ? 'w-full rounded-xl bg-muted/40 px-3.5 py-2.5 text-left transition-all hover:bg-muted/60 active:scale-[0.98]'
        : 'w-full rounded-lg px-2.5 py-1.5 text-left transition-colors hover:bg-accent/60'}
    >
      <div className="flex items-center gap-2 text-muted-foreground">
        <Gauge className={mobile ? 'h-4 w-4' : 'h-3.5 w-3.5'} />
        <span className="text-sm">{title}</span>
        {loading && <span className="ml-auto text-[10px] text-muted-foreground/60">…</span>}
      </div>
      {usage && !usage.available ? (
        <div className="mt-1 text-xs text-muted-foreground/70">
          {t('usage.unavailable', { defaultValue: 'No plan limits for this login' })}
        </div>
      ) : (
        <>
          <UsageBar label={t('usage.fiveHour', { defaultValue: '5-hour' })} window={usage?.fiveHour ?? null} withDay={false} t={t} />
          <UsageBar label={t('usage.week', { defaultValue: 'Week' })} window={usage?.sevenDay ?? null} withDay t={t} />
        </>
      )}
    </button>
  );
}

/** Rendered by SidebarFooter: the claude.ai plan's 5-hour and weekly usage. */
export default function SidebarUsage({ t }: { t: TFunction }) {
  return (
    <>
      <div className="hidden px-2 pt-1.5 md:block">
        <UsageBody t={t} mobile={false} />
      </div>
      <div className="px-3 pt-3 md:hidden">
        <UsageBody t={t} mobile />
      </div>
    </>
  );
}

/** Rendered by SidebarCollapsed: one icon whose tooltip carries both numbers. */
export function SidebarUsageIcon({ t }: { t: TFunction }) {
  const { usage, refresh } = usePlanUsage();
  const part = (label: string, window: PlanUsageWindow | null | undefined) => (
    `${label} ${window?.utilization == null ? '–' : `${Math.round(window.utilization)}%`}`
  );
  const summary = usage?.available
    ? `${part(t('usage.fiveHour', { defaultValue: '5-hour' }), usage.fiveHour)} · ${part(t('usage.week', { defaultValue: 'Week' }), usage.sevenDay)}`
    : t('usage.title', { defaultValue: 'Usage' });

  return (
    <button
      type="button"
      onClick={() => { void refresh(); }}
      className="group flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-accent/80"
      aria-label={summary}
      title={summary}
    >
      <Gauge className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-foreground" />
    </button>
  );
}
