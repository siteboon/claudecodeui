import { useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/shared/ui';
import UsageHeatmap from '@/modules/usage/UsageHeatmap';
import { useUsageDaily } from '@/modules/usage/hooks/useUsageDaily';
import {
  buildSummary,
  formatCompactNumber,
  formatExactNumber,
  getLocalDateKey,
  getTopDays,
  sumAll,
  type UsageAgentFilter,
  type UsageMetric,
} from '@/modules/usage/utils/usageMath';

const METRICS: UsageMetric[] = ['all', 'noCacheRead', 'inputOutput'];
const AGENTS: UsageAgentFilter[] = ['all', 'claude', 'codex'];

type SegmentedProps<T extends string> = {
  label: string;
  options: T[];
  value: T;
  getLabel: (option: T) => string;
  onChange: (option: T) => void;
};

function Segmented<T extends string>({ label, options, value, getLabel, onChange }: SegmentedProps<T>) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-1">
      <span className="mr-1 text-xs text-muted-foreground">{label}</span>
      {options.map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={value === option}
          onClick={() => onChange(option)}
          className={`min-h-11 rounded-md border px-2.5 py-1 text-xs transition-colors md:min-h-0 ${
            value === option
              ? 'border-primary bg-primary/10 text-foreground'
              : 'border-input text-muted-foreground hover:bg-accent/50'
          }`}
        >
          {getLabel(option)}
        </button>
      ))}
    </div>
  );
}

type TileProps = { label: string; value: number; locale: string };

function Tile({ label, value, locale }: TileProps) {
  return (
    <div className="rounded-lg border border-border/60 p-3">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums text-foreground" title={formatExactNumber(value, locale)}>
        {formatCompactNumber(value)}
      </p>
    </div>
  );
}

/** Rendered by UsageEntry inside its dialog: summary tiles, the daily heatmap and the busiest days, with metric and agent switches. */
export default function UsageView() {
  const { t, i18n } = useTranslation('usage');
  const locale = i18n.language || 'en';
  const { data, isLoading, error, refresh } = useUsageDaily();
  // Chosen count definition; defaults to "excluding cache reads" because cache reads are ~97% of raw tokens and hide real work.
  const [metric, setMetric] = useState<UsageMetric>('noCacheRead');
  // Chosen agent filter for the heatmap, tiles and busiest days.
  const [agent, setAgent] = useState<UsageAgentFilter>('all');

  const todayKey = getLocalDateKey(new Date());
  const days = useMemo(() => data?.days ?? [], [data]);
  const summary = useMemo(() => buildSummary(days, todayKey, agent, metric), [days, todayKey, agent, metric]);
  const topDays = useMemo(() => getTopDays(days, agent, metric, 5), [days, agent, metric]);
  const split = useMemo(
    () => ({ claude: sumAll(days, 'claude', metric), codex: sumAll(days, 'codex', metric) }),
    [days, metric],
  );
  const splitTotal = split.claude + split.codex;
  const hasAnyUsage = days.length > 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-foreground">{t('title')}</h2>
          <p className="text-xs text-muted-foreground">{t('description')}</p>
        </div>
        <Button variant="outline" size="sm" onClick={refresh} disabled={isLoading} className="min-h-11 md:min-h-0">
          <RefreshCw className={isLoading ? 'animate-spin' : ''} /> {t('refresh')}
        </Button>
      </div>

      <div className="space-y-2">
        <Segmented
          label={t('metric.label')}
          options={METRICS}
          value={metric}
          getLabel={(option) => t(`metric.${option}`)}
          onChange={setMetric}
        />
        <Segmented
          label={t('agent.label')}
          options={AGENTS}
          value={agent}
          getLabel={(option) => t(`agent.${option}`)}
          onChange={setAgent}
        />
      </div>

      {isLoading && !data && <p className="text-sm text-muted-foreground">{t('states.loading')}</p>}

      {error && (
        <div role="alert" className="flex flex-wrap items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <span>{t('states.error', { message: error })}</span>
          <Button variant="outline" size="sm" onClick={refresh} className="min-h-11 md:min-h-0">{t('states.retry')}</Button>
        </div>
      )}

      {data && !hasAnyUsage && !error && (
        <p className="rounded-md border border-dashed border-border/60 px-3 py-6 text-center text-sm text-muted-foreground">
          {t('states.empty')}
        </p>
      )}

      {data && hasAnyUsage && (
        <>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Tile label={t('tiles.today')} value={summary.today} locale={locale} />
            <Tile label={t('tiles.last7Days')} value={summary.last7Days} locale={locale} />
            <Tile label={t('tiles.last30Days')} value={summary.last30Days} locale={locale} />
            <Tile label={t('tiles.allTime')} value={summary.allTime} locale={locale} />
          </div>

          <div className="rounded-lg border border-border/60 p-3">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{t('tiles.split')}</p>
            {splitTotal === 0 ? (
              <p className="mt-1 text-xs text-muted-foreground">{t('split.none')}</p>
            ) : (
              <>
                <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                  <div className="bg-orange-500" style={{ width: `${(split.claude / splitTotal) * 100}%` }} />
                  <div className="bg-sky-500" style={{ width: `${(split.codex / splitTotal) * 100}%` }} />
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-foreground">
                  <span title={formatExactNumber(split.claude, locale)}>
                    <span className="mr-1 inline-block h-2 w-2 rounded-full bg-orange-500" />
                    {t('split.claude')} {formatCompactNumber(split.claude)} ({Math.round((split.claude / splitTotal) * 100)}%)
                  </span>
                  <span title={formatExactNumber(split.codex, locale)}>
                    <span className="mr-1 inline-block h-2 w-2 rounded-full bg-sky-500" />
                    {t('split.codex')} {formatCompactNumber(split.codex)} ({Math.round((split.codex / splitTotal) * 100)}%)
                  </span>
                </div>
              </>
            )}
          </div>

          <div className="rounded-lg border border-border/60 p-3">
            <h3 className="mb-2 text-xs font-medium text-foreground">{t('heatmap.title')}</h3>
            <UsageHeatmap days={days} todayKey={todayKey} agent={agent} metric={metric} />
          </div>

          <div className="rounded-lg border border-border/60 p-3">
            <h3 className="mb-2 text-xs font-medium text-foreground">{t('topDays.title')}</h3>
            {topDays.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t('topDays.empty')}</p>
            ) : (
              <ol className="space-y-1">
                {topDays.map((entry, index) => (
                  <li key={entry.date} className="flex items-center justify-between text-xs">
                    <span className="text-foreground">
                      <span className="mr-2 tabular-nums text-muted-foreground">{index + 1}.</span>
                      {entry.date}
                    </span>
                    <span className="tabular-nums text-foreground" title={formatExactNumber(entry.value, locale)}>
                      {formatCompactNumber(entry.value)}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </>
      )}

      <p className="text-[11px] text-muted-foreground">
        {t('note', { files: data?.filesScanned ?? 0 })}
      </p>
    </div>
  );
}
