import type { RateLimitInfo, RateLimitWindow } from '@/shared/types';

/**
 * Short names for the quota windows the SDK reports.
 *
 * The wire values are snake_case and only five are known today; anything new
 * falls back to its own name rather than being dropped, so a window added
 * upstream still shows up (spelled oddly) instead of silently disappearing.
 */
const WINDOW_LABELS: Record<string, string> = {
  five_hour: '5h',
  seven_day: '7d',
  seven_day_opus: '7d Opus',
  seven_day_sonnet: '7d Sonnet',
  overage: 'Extra',
};

/** Display order: the short window first, then the weekly ones, then the rest. */
const WINDOW_ORDER = ['five_hour', 'seven_day', 'seven_day_opus', 'seven_day_sonnet', 'overage'];

export function rateLimitWindowLabel(type: string): string {
  return WINDOW_LABELS[type] || type.replace(/_/g, ' ');
}

export function sortRateLimitWindows(windows: RateLimitWindow[]): RateLimitWindow[] {
  return [...windows].sort((left, right) => {
    const leftIndex = WINDOW_ORDER.indexOf(left.type);
    const rightIndex = WINDOW_ORDER.indexOf(right.type);
    return (leftIndex === -1 ? WINDOW_ORDER.length : leftIndex)
      - (rightIndex === -1 ? WINDOW_ORDER.length : rightIndex);
  });
}

/** `utilization` arrives as a fraction of the window, so a percent needs the ×100. */
export function rateLimitPercent(utilization: number): number {
  if (!Number.isFinite(utilization) || utilization <= 0) {
    return 0;
  }
  return Math.min(100, Math.round(utilization * 100));
}

/** The window closest to full — the one worth showing when there is room for only one. */
export function busiestRateLimitWindow(info: RateLimitInfo | null): RateLimitWindow | null {
  if (!info?.windows?.length) {
    return null;
  }
  return info.windows.reduce(
    (worst, window) => (window.utilization > worst.utilization ? window : worst),
    info.windows[0],
  );
}

export function rateLimitTone(percent: number, status?: string): string {
  if (status === 'rejected') {
    return 'text-red-500';
  }
  if (percent >= 90) {
    return 'text-red-500';
  }
  if (percent >= 75) {
    return 'text-amber-500';
  }
  return 'text-muted-foreground/70';
}

/**
 * "in 2h 15m" for a reset that has not happened yet, "now" once it passes.
 *
 * Relative rather than absolute on purpose: the epoch seconds the SDK sends are
 * only useful as "how long until this frees up", and an absolute clock time
 * makes the reader do that subtraction.
 */
export function formatResetsIn(resetsAt: number | null, now = Date.now()): string | null {
  if (!resetsAt || !Number.isFinite(resetsAt)) {
    return null;
  }

  const seconds = Math.round((resetsAt * 1000 - now) / 1000);
  if (seconds <= 0) {
    return 'now';
  }

  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (days > 0) {
    return hours > 0 ? `in ${days}d ${hours}h` : `in ${days}d`;
  }
  if (hours > 0) {
    return minutes > 0 ? `in ${hours}h ${minutes}m` : `in ${hours}h`;
  }
  return `in ${Math.max(1, minutes)}m`;
}
