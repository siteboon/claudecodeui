import { describe, expect, it } from 'vitest';

import type { UsageCounts, UsageDay } from '@/shared/types';
import {
  addDaysToKey,
  buildHeatmapGrid,
  buildSummary,
  createLevelFunction,
  formatCompactNumber,
  getLocalDateKey,
  getTopDays,
  getWeekdayIndex,
  selectMetric,
} from '@/modules/usage/utils/usageMath';

function counts(input: number, output: number, cacheRead: number, cacheCreation: number): UsageCounts {
  return { input, output, cacheRead, cacheCreation, total: input + output + cacheRead + cacheCreation };
}

const ZERO = counts(0, 0, 0, 0);

function day(date: string, claude: UsageCounts, codex: UsageCounts = ZERO): UsageDay {
  return {
    date,
    claude,
    codex,
    total: counts(
      claude.input + codex.input,
      claude.output + codex.output,
      claude.cacheRead + codex.cacheRead,
      claude.cacheCreation + codex.cacheCreation,
    ),
  };
}

describe('selectMetric', () => {
  const sample = counts(10, 20, 1000, 5);
  it('selects the three metrics', () => {
    expect(selectMetric(sample, 'all')).toBe(1035);
    expect(selectMetric(sample, 'noCacheRead')).toBe(35);
    expect(selectMetric(sample, 'inputOutput')).toBe(30);
  });
});

describe('date keys', () => {
  it('adds days across month, year and leap boundaries without time-zone drift', () => {
    expect(addDaysToKey('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDaysToKey('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDaysToKey('2028-02-28', 1)).toBe('2028-02-29');
    // Days around European and US daylight-saving changes stay one calendar day apart.
    expect(addDaysToKey('2026-03-28', 1)).toBe('2026-03-29');
    expect(addDaysToKey('2026-03-29', 1)).toBe('2026-03-30');
    expect(addDaysToKey('2026-11-01', 1)).toBe('2026-11-02');
  });

  it('numbers weekdays Monday=0', () => {
    expect(getWeekdayIndex('2026-10-26')).toBe(0); // Monday
    expect(getWeekdayIndex('2026-10-25')).toBe(6); // Sunday
  });

  it('reads the local calendar date', () => {
    expect(getLocalDateKey(new Date(2026, 9, 5, 23, 59))).toBe('2026-10-05');
    expect(getLocalDateKey(new Date(2026, 0, 1, 0, 0))).toBe('2026-01-01');
  });
});

describe('createLevelFunction', () => {
  it('maps zero to 0 and no data to all zeros', () => {
    expect(createLevelFunction([])(5)).toBe(0);
    expect(createLevelFunction([0, 0])(0)).toBe(0);
  });

  it('treats a single non-zero value as the busiest level', () => {
    const level = createLevelFunction([0, 0, 42]);
    expect(level(42)).toBe(4);
    expect(level(0)).toBe(0);
  });

  it('splits non-zero values into quartile levels', () => {
    const level = createLevelFunction([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(level(1)).toBe(1);
    expect(level(3)).toBe(2);
    expect(level(5)).toBe(3);
    expect(level(8)).toBe(4);
  });

  it('is not skewed by days with no usage', () => {
    const level = createLevelFunction([0, 0, 0, 0, 0, 1, 2, 3, 4]);
    expect(level(4)).toBe(4);
    expect(level(1)).toBe(1);
  });
});

describe('buildHeatmapGrid', () => {
  // Wednesday 2026-10-28.
  const today = '2026-10-28';

  it('builds 53 week columns of 7 cells ending with the current week', () => {
    const grid = buildHeatmapGrid([], today, 'all', 'all');
    expect(grid.weeks).toHaveLength(53);
    expect(grid.weeks.every((week) => week.length === 7)).toBe(true);
    expect(grid.monthLabels).toHaveLength(53);
    expect(grid.weeks[0][0].date).toBe('2025-10-27');
    expect(grid.weeks[52][0].date).toBe('2026-10-26');
  });

  it('puts today in its weekday row of the last column and pads the days after it', () => {
    const grid = buildHeatmapGrid([], today, 'all', 'all');
    const lastWeek = grid.weeks[52];
    expect(lastWeek[2].date).toBe(today);
    expect(lastWeek[3].date).toBeNull();
    expect(lastWeek[6].date).toBeNull();
  });

  it('shows a full last column when today is a Sunday', () => {
    const grid = buildHeatmapGrid([], '2026-10-25', 'all', 'all');
    expect(grid.weeks[52][6].date).toBe('2026-10-25');
    expect(grid.weeks[52].every((cell) => cell.date !== null)).toBe(true);
  });

  it('has no usage anywhere for no data', () => {
    const grid = buildHeatmapGrid([], today, 'all', 'all');
    expect(grid.weeks.flat().every((cell) => cell.level === 0 && cell.value === 0)).toBe(true);
  });

  it('marks a single active day as the top level and leaves others empty', () => {
    const grid = buildHeatmapGrid([day('2026-10-27', counts(1, 2, 3, 4))], today, 'all', 'all');
    const cells = grid.weeks.flat().filter((cell) => cell.date !== null);
    const active = cells.filter((cell) => cell.value > 0);
    expect(active).toEqual([{ date: '2026-10-27', value: 10, level: 4 }]);
  });

  it('applies the metric and agent filter to the cell values', () => {
    const days = [day('2026-10-27', counts(1, 2, 1000, 3), counts(10, 20, 0, 0))];
    const find = (agent: 'all' | 'claude' | 'codex', metric: 'all' | 'noCacheRead' | 'inputOutput') =>
      buildHeatmapGrid(days, today, agent, metric).weeks.flat().find((cell) => cell.date === '2026-10-27')?.value;
    expect(find('all', 'all')).toBe(1036);
    expect(find('all', 'noCacheRead')).toBe(36);
    expect(find('claude', 'inputOutput')).toBe(3);
    expect(find('codex', 'all')).toBe(30);
  });

  it('ignores days older than the grid and days in the future', () => {
    const days = [day('2020-01-01', counts(9, 9, 9, 9)), day('2026-11-05', counts(9, 9, 9, 9))];
    const grid = buildHeatmapGrid(days, today, 'all', 'all');
    expect(grid.weeks.flat().every((cell) => cell.value === 0)).toBe(true);
  });

  it('labels a column when its Monday starts a new month, starting with the first column', () => {
    const grid = buildHeatmapGrid([], today, 'all', 'all');
    expect(grid.monthLabels[0]).toBe(9); // October (2025-10-27)
    const labelled = grid.monthLabels.filter((label) => label !== null);
    // 13 distinct months are visible across 53 weeks.
    expect(labelled).toHaveLength(13);
    expect(grid.monthLabels[52]).toBeNull(); // 2026-10-26 is still October
  });
});

describe('buildSummary and getTopDays', () => {
  const today = '2026-10-28';
  const days = [
    day('2026-10-28', counts(1, 0, 0, 0)),
    day('2026-10-22', counts(10, 0, 0, 0)), // 6 days back: inside "last 7 days"
    day('2026-10-21', counts(100, 0, 0, 0)), // 7 days back: outside
    day('2026-09-29', counts(1000, 0, 0, 0)), // 29 days back: inside "last 30 days"
    day('2026-09-28', counts(10000, 0, 0, 0)), // 30 days back: outside
  ];

  it('sums today, 7 days (including today), 30 days and all time', () => {
    expect(buildSummary(days, today, 'all', 'all')).toEqual({
      today: 1,
      last7Days: 11,
      last30Days: 1111,
      allTime: 11111,
    });
  });

  it('returns zeros for no data', () => {
    expect(buildSummary([], today, 'all', 'all')).toEqual({ today: 0, last7Days: 0, last30Days: 0, allTime: 0 });
  });

  it('lists the busiest days, newest first on ties, skipping empty days', () => {
    const top = getTopDays(
      [...days, day('2026-10-20', counts(10000, 0, 0, 0)), day('2026-10-01', ZERO)],
      'all',
      'all',
      3,
    );
    expect(top.map((entry) => entry.date)).toEqual(['2026-10-20', '2026-09-28', '2026-09-29']);
  });
});

describe('formatCompactNumber', () => {
  it('formats small, thousand, million and billion values', () => {
    expect(formatCompactNumber(0)).toBe('0');
    expect(formatCompactNumber(999)).toBe('999');
    expect(formatCompactNumber(1000)).toBe('1K');
    expect(formatCompactNumber(1234)).toBe('1.2K');
    expect(formatCompactNumber(1_200_000)).toBe('1.2M');
    expect(formatCompactNumber(3_400_000_000)).toBe('3.4B');
    expect(formatCompactNumber(2_500_000_000_000)).toBe('2.5T');
  });

  it('never shows 1000 of a unit', () => {
    expect(formatCompactNumber(999_999)).toBe('1M');
    expect(formatCompactNumber(999_950_000)).toBe('1B');
  });
});
