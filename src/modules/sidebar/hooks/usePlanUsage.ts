import { useCallback, useEffect, useState } from 'react';

import { api } from '@/shared/api';

export type PlanUsageWindow = {
  utilization: number | null;
  resetsAt: string | null;
};

export type PlanUsage = {
  available: boolean;
  subscriptionType: string | null;
  fiveHour: PlanUsageWindow | null;
  sevenDay: PlanUsageWindow | null;
  fetchedAt: string;
};

// Each read starts a short-lived CLI process on the server, so poll gently.
const POLL_MS = 5 * 60 * 1000;

/** The claude.ai plan limits (5-hour and weekly), read on mount, every five minutes, and on demand. */
export function usePlanUsage() {
  const [usage, setUsage] = useState<PlanUsage | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (refresh = false) => {
    setLoading(true);
    try {
      const response = await api.providers.claudePlanUsage(refresh);
      if (!response.ok) {
        return;
      }
      const body = await response.json();
      if (body?.data) {
        setUsage(body.data as PlanUsage);
      }
    } catch {
      // Keep the last reading; the next poll tries again.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => { void load(); }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  const refresh = useCallback(() => load(true), [load]);

  return { usage, loading, refresh };
}

/** "9:20 AM" for the 5-hour window, "Thu 1:59 PM" for the week, in the viewer's own clock. */
export function formatResetTime(resetsAt: string | null, withDay: boolean): string | null {
  if (!resetsAt) {
    return null;
  }
  const date = new Date(resetsAt);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toLocaleString([], withDay
    ? { weekday: 'short', hour: 'numeric', minute: '2-digit' }
    : { hour: 'numeric', minute: '2-digit' });
}
