import { useCallback, useEffect, useState } from 'react';

import { api, readApiJson } from '@/shared/api';
import type { UsageDailyData } from '@/shared/types';
import { getErrorText } from '@/shared/utils';

type UsageDailyState = {
  data: UsageDailyData | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
};

/** Loads `GET /api/usage/daily` once when mounted and again on `refresh()`. The server rescans local logs on each call, so there is no polling. */
export function useUsageDaily(): UsageDailyState {
  // Last good payload; kept while a refresh runs so the numbers do not flash away.
  const [data, setData] = useState<UsageDailyData | null>(null);
  // True while a request is in flight (initial load and refreshes).
  const [isLoading, setIsLoading] = useState(true);
  // Message of the last failed request, cleared by the next success.
  const [error, setError] = useState<string | null>(null);
  // Bumped by `refresh()` to trigger another request.
  const [requestTick, setRequestTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    // The loading flag is raised by `refresh()` / initial state, not here, so this effect only syncs with the server.
    void (async () => {
      try {
        const response = await api.usage.daily();
        const body = await readApiJson<{ data: UsageDailyData }>(response);
        if (!cancelled) {
          setData(body.data);
          setError(null);
        }
      } catch (loadError) {
        if (!cancelled) setError(getErrorText(loadError));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [requestTick]);

  const refresh = useCallback(() => {
    setIsLoading(true);
    setRequestTick((tick) => tick + 1);
  }, []);

  return { data, isLoading, error, refresh };
}
