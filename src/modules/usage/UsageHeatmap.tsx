import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';

import type { UsageDay } from '@/shared/types';
import {
  addDaysToKey,
  buildHeatmapGrid,
  formatExactNumber,
  getDayValue,
  type HeatmapCell,
  type UsageAgentFilter,
  type UsageMetric,
} from '@/modules/usage/utils/usageMath';

const LEVEL_CLASSES: Record<HeatmapCell['level'], string> = {
  0: 'bg-muted',
  1: 'bg-emerald-500/25',
  2: 'bg-emerald-500/45',
  3: 'bg-emerald-500/70',
  4: 'bg-emerald-500',
};

/** Formats a date key in the viewer's language; UTC keeps the calendar date from shifting with the time zone. */
function formatDateKey(key: string, locale: string, options: Intl.DateTimeFormatOptions): string {
  const [year, month, day] = key.split('-').map(Number);
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(Date.UTC(year, month - 1, day));
}

type UsageHeatmapProps = {
  days: UsageDay[];
  todayKey: string;
  agent: UsageAgentFilter;
  metric: UsageMetric;
};

/** Rendered by UsageView: the GitHub-style daily grid (weeks as columns, Monday to Sunday as rows) with a details line for the hovered or focused day. */
export default function UsageHeatmap({ days, todayKey, agent, metric }: UsageHeatmapProps) {
  const { t, i18n } = useTranslation('usage');
  const locale = i18n.language || 'en';
  const grid = useMemo(() => buildHeatmapGrid(days, todayKey, agent, metric), [days, todayKey, agent, metric]);
  const dayByDate = useMemo(() => new Map(days.map((day) => [day.date, day])), [days]);
  const firstDate = grid.weeks[0][0].date as string;

  // The one cell that is a tab stop (roving tabindex): 371 focusable cells would make the page unusable by keyboard.
  const [activeDate, setActiveDate] = useState(todayKey);
  // The day shown in the details line; follows the pointer and keyboard focus.
  const [detailDate, setDetailDate] = useState<string | null>(null);
  const cellRefs = useRef(new Map<string, HTMLButtonElement>());

  const describe = (date: string): { label: string; detail: string } => {
    const day = dayByDate.get(date);
    const prettyDate = formatDateKey(date, locale, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
    if (!day) {
      return { label: t('heatmap.cellLabelEmpty', { date: prettyDate }), detail: `${prettyDate} · ${t('tooltip.noUsage')}` };
    }
    const total = getDayValue(day, agent, metric);
    const claude = getDayValue(day, 'claude', metric);
    const codex = getDayValue(day, 'codex', metric);
    return {
      label: t('heatmap.cellLabel', {
        date: prettyDate,
        value: formatExactNumber(total, locale),
        claude: formatExactNumber(claude, locale),
        codex: formatExactNumber(codex, locale),
      }),
      detail: `${prettyDate} · ${t('tooltip.total')} ${formatExactNumber(total, locale)} · ${t('tooltip.claude')} ${formatExactNumber(claude, locale)} · ${t('tooltip.codex')} ${formatExactNumber(codex, locale)}`,
    };
  };

  const moveFocus = (from: string, event: KeyboardEvent) => {
    const offsets: Record<string, number> = { ArrowLeft: -7, ArrowRight: 7, ArrowUp: -1, ArrowDown: 1 };
    const offset = offsets[event.key];
    if (offset === undefined) return;
    event.preventDefault();
    const target = addDaysToKey(from, offset);
    if (target < firstDate || target > todayKey) return;
    setActiveDate(target);
    cellRefs.current.get(target)?.focus();
  };

  const shownDetail = detailDate ? describe(detailDate).detail : t('heatmap.none');

  return (
    <div>
      <div className="overflow-x-auto pb-2">
        <div
          role="grid"
          aria-label={t('heatmap.label')}
          className="inline-grid gap-[3px]"
          style={{ gridTemplateColumns: `1.75rem repeat(${grid.weeks.length}, 11px)` }}
        >
          {/* Month label row */}
          <div role="row" className="contents">
            <span aria-hidden="true" />
            {grid.monthLabels.map((month, index) => (
              <span
                key={`month-${index}`}
                role="columnheader"
                className="overflow-visible whitespace-nowrap text-[10px] leading-3 text-muted-foreground"
              >
                {month === null ? '' : formatDateKey(`2026-${String(month + 1).padStart(2, '0')}-01`, locale, { month: 'short' })}
              </span>
            ))}
          </div>

          {/* Seven weekday rows, Monday first */}
          {Array.from({ length: 7 }, (_, weekday) => (
            <div key={`row-${weekday}`} role="row" className="contents">
              <span aria-hidden="true" className="pr-1 text-right text-[10px] leading-[11px] text-muted-foreground">
                {weekday === 0 ? t('weekday.mon') : weekday === 2 ? t('weekday.wed') : weekday === 4 ? t('weekday.fri') : ''}
              </span>
              {grid.weeks.map((week, weekIndex) => {
                const cell = week[weekday];
                if (cell.date === null) {
                  return <span key={`pad-${weekIndex}`} role="gridcell" aria-hidden="true" className="h-[11px] w-[11px]" />;
                }
                const date = cell.date;
                const { label } = describe(date);
                return (
                  <button
                    key={date}
                    ref={(node) => {
                      if (node) cellRefs.current.set(date, node);
                      else cellRefs.current.delete(date);
                    }}
                    type="button"
                    role="gridcell"
                    aria-label={label}
                    title={describe(date).detail}
                    tabIndex={date === activeDate ? 0 : -1}
                    onFocus={() => {
                      setActiveDate(date);
                      setDetailDate(date);
                    }}
                    onBlur={() => setDetailDate((current) => (current === date ? null : current))}
                    onMouseEnter={() => setDetailDate(date)}
                    onMouseLeave={() => setDetailDate((current) => (current === date ? null : current))}
                    onKeyDown={(event) => moveFocus(date, event)}
                    className={`h-[11px] w-[11px] rounded-[2px] outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 ${LEVEL_CLASSES[cell.level]} ${date === todayKey ? 'ring-1 ring-foreground/40' : ''}`}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <p className="min-h-4 text-xs text-foreground" aria-live="polite">{shownDetail}</p>
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground" aria-hidden="true">
          <span>{t('heatmap.less')}</span>
          {([0, 1, 2, 3, 4] as const).map((level) => (
            <span key={level} className={`h-[11px] w-[11px] rounded-[2px] ${LEVEL_CLASSES[level]}`} />
          ))}
          <span>{t('heatmap.more')}</span>
        </div>
      </div>
    </div>
  );
}
