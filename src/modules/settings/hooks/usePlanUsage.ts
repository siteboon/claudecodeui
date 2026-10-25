import { useCallback, useEffect, useState } from 'react';

import { api } from '@/shared/api';

type PlanUsageWindow = {
  utilization: number | null;
  resetsAt: string | null;
};

type PlanUsage = {
  available: boolean;
  subscriptionType: string | null;
  fiveHour: PlanUsageWindow | null;
  sevenDay: PlanUsageWindow | null;
  fetchedAt: string;
};

// Each read starts a short-lived CLI process on the server, so poll gently.
const POLL_MS = 5 * 60 * 1000;

/** Used by PlanUsageCard to poll the selected provider's plan limits. */
export function usePlanUsage(provider: 'claude' | 'codex') {
  // Keep each response associated with its provider so switching tabs never shows the other plan.
  const [reading, setReading] = useState<{ provider: 'claude' | 'codex'; usage: PlanUsage } | null>(null);
  // Shows pending reads and prevents repeated refresh clicks.
  const [loading, setLoading] = useState(false);
  // Reports a failed read for the selected provider while retaining any last good reading.
  const [failedProvider, setFailedProvider] = useState<'claude' | 'codex' | null>(null);

  const load = useCallback(async (refresh = false) => {
    setLoading(true);
    try {
      const response = await api.providers.planUsage(provider, refresh);
      if (!response.ok) {
        throw new Error('Plan usage request failed');
      }
      const body = await response.json();
      if (body?.data) {
        setReading({ provider, usage: body.data as PlanUsage });
        setFailedProvider(null);
      } else {
        throw new Error('Plan usage response was empty');
      }
    } catch {
      setFailedProvider(provider);
    } finally {
      setLoading(false);
    }
  }, [provider]);

  useEffect(() => {
    const initial = window.setTimeout(() => { void load(); }, 0);
    const timer = window.setInterval(() => { void load(); }, POLL_MS);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [load]);

  const refresh = useCallback(() => load(true), [load]);

  return {
    usage: reading?.provider === provider ? reading.usage : null,
    loading,
    error: failedProvider === provider,
    refresh,
  };
}

/** "9:20 AM" for the 5-hour window, "Thu 1:59 PM" for the week, in the viewer's own clock. */
