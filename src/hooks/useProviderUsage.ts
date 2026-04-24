import { useCallback, useEffect, useRef, useState } from 'react';

import { authenticatedFetch } from '../utils/api.js';

export type UsageWindow = {
  utilization: number;
  resetsAt: number;
} | null;

export type ProviderUsageSnapshot = {
  provider: 'claude' | 'codex';
  email: string | null;
  displayName: string | null;
  planType: string | null;
  method: 'oauth' | 'api_key' | null;
  fiveHour: UsageWindow;
  sevenDay: UsageWindow;
  fetchedAt: number;
  stale?: boolean;
  error?: string;
};

type FetchState = {
  snapshot: ProviderUsageSnapshot | null;
  isLoading: boolean;
  error: string | null;
};

const REFRESH_INTERVAL_MS = 15 * 60 * 1000;
const VISIBILITY_DEBOUNCE_MS = 5 * 60 * 1000;

/**
 * Fetches and refreshes a provider's usage snapshot from the server.
 *
 * Cache model: the server owns the 15-min cache. The hook polls every 15 min
 * and opportunistically refreshes when the tab regains visibility (debounced
 * to 5 min so rapid focus changes don't thrash the API). `refresh()` forces
 * a server-side bypass for user-initiated reloads.
 */
export function useProviderUsage(provider: 'claude' | 'codex') {
  const [state, setState] = useState<FetchState>({
    snapshot: null,
    isLoading: true,
    error: null,
  });
  const lastFetchRef = useRef(0);
  const mountedRef = useRef(true);

  const load = useCallback(
    async (force: boolean) => {
      lastFetchRef.current = Date.now();
      try {
        const url = `/api/providers/${provider}/usage${force ? '?refresh=true' : ''}`;
        const response = await authenticatedFetch(url);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const json = (await response.json()) as { success: boolean; data?: ProviderUsageSnapshot };
        if (!mountedRef.current) return;
        if (!json.success || !json.data) {
          throw new Error('Malformed usage response');
        }
        setState({ snapshot: json.data, isLoading: false, error: json.data.error ?? null });
      } catch (err) {
        if (!mountedRef.current) return;
        const message = err instanceof Error ? err.message : 'Failed to load usage';
        setState((prev) => ({
          snapshot: prev.snapshot,
          isLoading: false,
          error: message,
        }));
      }
    },
    [provider],
  );

  useEffect(() => {
    mountedRef.current = true;
    void load(false);
    const timer = window.setInterval(() => {
      void load(false);
    }, REFRESH_INTERVAL_MS);

    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastFetchRef.current < VISIBILITY_DEBOUNCE_MS) return;
      void load(false);
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      mountedRef.current = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [load]);

  const refresh = useCallback(() => {
    void load(true);
  }, [load]);

  return { ...state, refresh };
}
