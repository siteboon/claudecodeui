import type { UsageCounts, UsageDay } from '@/shared/types';

/** Which token counts the numbers add up; cache reads are ~97% of real usage, so "all" drowns everything else. */
export type UsageMetric = 'all' | 'noCacheRead' | 'inputOutput';

/** Which agent's usage is shown. */
export type UsageAgentFilter = 'all' | 'claude' | 'codex';

/** One cell of the heatmap grid. `date` is null for padding cells after today. */
export type HeatmapCell = {
  date: string | null;
  value: number;
  /** 0 = no usage, 1-4 = quartile buckets of the non-zero days. */
  level: 0 | 1 | 2 | 3 | 4;
};

export type HeatmapGrid = {
  /** Columns are weeks (oldest first); each has 7 cells, Monday first. */
  weeks: HeatmapCell[][];
  /** Month index (0-11) to label above a column, or null when the column carries no label. */
  monthLabels: Array<number | null>;
};

export const EMPTY_COUNTS: UsageCounts = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, total: 0 };

/** The number a metric reads from a set of counts. */
export function selectMetric(counts: UsageCounts, metric: UsageMetric): number {
  switch (metric) {
    case 'inputOutput':
      return counts.input + counts.output;
    case 'noCacheRead':
      return counts.input + counts.output + counts.cacheCreation;
    default:
      return counts.total;
  }
}

/** The counts of one day for the chosen agent filter. */
export function getDayCounts(day: UsageDay, agent: UsageAgentFilter): UsageCounts {
  return agent === 'all' ? day.total : day[agent];
}

/** The metric value of one day for the chosen agent and metric. */
export function getDayValue(day: UsageDay, agent: UsageAgentFilter, metric: UsageMetric): number {
  return selectMetric(getDayCounts(day, agent), metric);
}

// ---- date keys (timezone neutral) ------------------------------------------
// A date key is a plain `YYYY-MM-DD` string. All arithmetic goes through UTC midnight of that
// calendar date, so it never shifts with the viewer's time zone or a daylight-saving change.

const DAY_MS = 86_400_000;

function keyToUtcMs(key: string): number {
  const [year, month, day] = key.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

function utcMsToKey(ms: number): string {
  const date = new Date(ms);
  const year = String(date.getUTCFullYear()).padStart(4, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Local calendar date of `now` as a date key; this is the only place the viewer's time zone is read. */
export function getLocalDateKey(now: Date): string {
  const year = String(now.getFullYear()).padStart(4, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function addDaysToKey(key: string, days: number): string {
  return utcMsToKey(keyToUtcMs(key) + days * DAY_MS);
}

/** 0 = Monday ... 6 = Sunday. */
export function getWeekdayIndex(key: string): number {
  const sundayFirst = new Date(keyToUtcMs(key)).getUTCDay();
  return (sundayFirst + 6) % 7;
}

/** Month index (0-11) of a date key. */
export function getMonthIndex(key: string): number {
  return Number(key.slice(5, 7)) - 1;
}

// ---- levels -----------------------------------------------------------------

/** Linear-interpolated quantile of an ascending-sorted list. */
function quantile(sorted: number[], q: number): number {
  if (sorted.length === 1) return sorted[0];
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

/**
 * Builds a value -> level function from the non-zero values: quartile thresholds split them into
 * levels 1-4, zero is always level 0. With a single non-zero value that value is the busiest (4).
 */
export function createLevelFunction(values: number[]): (value: number) => HeatmapCell['level'] {
  const nonZero = values.filter((value) => value > 0).sort((a, b) => a - b);
  if (nonZero.length === 0) return () => 0;
  if (nonZero.length === 1) return (value) => (value > 0 ? 4 : 0);
  const [t1, t2, t3] = [0.25, 0.5, 0.75].map((q) => quantile(nonZero, q));
  return (value) => {
    if (value <= 0) return 0;
    if (value <= t1) return 1;
    if (value <= t2) return 2;
    if (value <= t3) return 3;
    return 4;
  };
}

// ---- grid -------------------------------------------------------------------

/**
 * Builds the GitHub-style grid: `weekCount` columns of Monday-Sunday ending with the week that
 * contains `todayKey`. Cells after today are padding (date null, level 0). Levels are computed from
 * the days shown, so each metric/agent combination fills the whole scale.
 */
export function buildHeatmapGrid(
  days: UsageDay[],
  todayKey: string,
  agent: UsageAgentFilter,
  metric: UsageMetric,
  weekCount = 53,
): HeatmapGrid {
  const currentMonday = addDaysToKey(todayKey, -getWeekdayIndex(todayKey));
  const firstMonday = addDaysToKey(currentMonday, -(weekCount - 1) * 7);
  const lastShownKey = addDaysToKey(currentMonday, 6);

  const valueByDate = new Map<string, number>();
  for (const day of days) {
    if (day.date >= firstMonday && day.date <= todayKey) {
      valueByDate.set(day.date, getDayValue(day, agent, metric));
    }
  }
  const levelOf = createLevelFunction([...valueByDate.values()]);

  const weeks: HeatmapCell[][] = [];
  const monthLabels: Array<number | null> = [];
  let previousMonth: number | null = null;

  for (let week = 0; week < weekCount; week += 1) {
    const monday = addDaysToKey(firstMonday, week * 7);
    const cells: HeatmapCell[] = [];
    for (let weekday = 0; weekday < 7; weekday += 1) {
      const date = addDaysToKey(monday, weekday);
      if (date > todayKey || date > lastShownKey) {
        cells.push({ date: null, value: 0, level: 0 });
        continue;
      }
      const value = valueByDate.get(date) ?? 0;
      cells.push({ date, value, level: levelOf(value) });
    }
    weeks.push(cells);

    // Label a column when its Monday starts a new month (the first column is labelled too).
    const month = getMonthIndex(monday);
    monthLabels.push(month !== previousMonth ? month : null);
    previousMonth = month;
  }

  return { weeks, monthLabels };
}

// ---- summaries --------------------------------------------------------------

/** Sum of the metric over the inclusive date-key range `[fromKey, toKey]`. */
export function sumRange(
  days: UsageDay[],
  fromKey: string,
  toKey: string,
  agent: UsageAgentFilter,
  metric: UsageMetric,
): number {
  let sum = 0;
  for (const day of days) {
    if (day.date >= fromKey && day.date <= toKey) sum += getDayValue(day, agent, metric);
  }
  return sum;
}

/** Sum of the metric over every day. */
export function sumAll(days: UsageDay[], agent: UsageAgentFilter, metric: UsageMetric): number {
  return days.reduce((sum, day) => sum + getDayValue(day, agent, metric), 0);
}

export type UsageSummary = {
  today: number;
  last7Days: number;
  last30Days: number;
  allTime: number;
};

/** The four summary tiles. "Last 7 days" includes today (today and the six days before it). */
export function buildSummary(
  days: UsageDay[],
  todayKey: string,
  agent: UsageAgentFilter,
  metric: UsageMetric,
): UsageSummary {
  return {
    today: sumRange(days, todayKey, todayKey, agent, metric),
    last7Days: sumRange(days, addDaysToKey(todayKey, -6), todayKey, agent, metric),
    last30Days: sumRange(days, addDaysToKey(todayKey, -29), todayKey, agent, metric),
    allTime: sumAll(days, agent, metric),
  };
}

/** The busiest days by the chosen metric, highest first (ties: newest first). Days with no usage are skipped. */
export function getTopDays(
  days: UsageDay[],
  agent: UsageAgentFilter,
  metric: UsageMetric,
  limit = 5,
): Array<{ date: string; value: number }> {
  return days
    .map((day) => ({ date: day.date, value: getDayValue(day, agent, metric) }))
    .filter((entry) => entry.value > 0)
    .sort((a, b) => b.value - a.value || b.date.localeCompare(a.date))
    .slice(0, limit);
}

// ---- formatting -------------------------------------------------------------

const COMPACT_UNITS: Array<{ limit: number; suffix: string }> = [
  { limit: 1e12, suffix: 'T' },
  { limit: 1e9, suffix: 'B' },
  { limit: 1e6, suffix: 'M' },
  { limit: 1e3, suffix: 'K' },
];

/** 1234 -> "1.2K", 3.4e9 -> "3.4B"; values under 1000 are shown whole. One decimal at most, never "1.0K". */
export function formatCompactNumber(value: number): string {
  const sign = value < 0 ? '-' : '';
  const absolute = Math.abs(value);
  for (const { limit, suffix } of COMPACT_UNITS) {
    if (absolute >= limit) {
      const scaled = Math.round((absolute / limit) * 10) / 10;
      // Rounding can reach the next unit (999.96K -> 1000K): promote it.
      if (scaled >= 1000 && suffix !== 'T') {
        return formatCompactNumber(sign === '-' ? -limit * 1000 : limit * 1000);
      }
      return `${sign}${Number.isInteger(scaled) ? scaled.toFixed(0) : scaled.toFixed(1)}${suffix}`;
    }
  }
  return `${sign}${Math.round(absolute)}`;
}

/** The exact value with thousands separators, for tooltips. */
export function formatExactNumber(value: number, locale?: string): string {
  return Math.round(value).toLocaleString(locale);
}
