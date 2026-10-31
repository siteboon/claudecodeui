import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { api } from '@/shared/api';
import { usePluginProviders, withPluginProviderIds } from '@/shared/providerRegistry';
import type {
  LLMProvider,
  ProviderAuthStatus,
  ProviderAuthStatusMap,
  ProviderAuthSubscriptionOverride,
} from '@/shared/types';

const CLI_PROVIDERS: LLMProvider[] = ['claude', 'cursor', 'codex', 'opencode'];

/**
 * Creates the initial auth status map for the four built-in providers.
 *
 * @param loading - Initial loading flag state for each provider.
 * @returns Map of built-in providers to their initial auth status.
 */
const createInitialProviderAuthStatusMap = (loading = true): ProviderAuthStatusMap => ({
  claude: { authenticated: false, email: null, method: null, error: null, loading },
  cursor: { authenticated: false, email: null, method: null, error: null, loading },
  codex: { authenticated: false, email: null, method: null, error: null, loading },
  opencode: { authenticated: false, email: null, method: null, error: null, loading },
});

type ProviderAuthStatusPayload = {
  authenticated?: boolean;
  email?: string | null;
  method?: string | null;
  error?: string | null;
  subscriptionOverride?: ProviderAuthSubscriptionOverride | null;
  installedVersion?: string | null;
};

type ProviderAuthStatusApiResponse = {
  success: boolean;
  data: ProviderAuthStatusPayload;
};

const FALLBACK_STATUS_ERROR = 'Failed to check authentication status';
const FALLBACK_UNKNOWN_ERROR = 'Unknown error';

/**
 * Normalizes caught errors into human-readable strings.
 *
 * @param error - The caught rejection reason or exception.
 * @returns Error message string.
 */
const toErrorMessage = (error: unknown): string => (
  error instanceof Error ? error.message : FALLBACK_UNKNOWN_ERROR
);

/**
 * Normalizes an API status payload into a ProviderAuthStatus object.
 *
 * @param payload - Raw API status payload.
 * @param fallbackError - Error message to use when payload lacks an error.
 * @returns Normalized ProviderAuthStatus.
 */
const toProviderAuthStatus = (
  payload: ProviderAuthStatusPayload,
  fallbackError: string | null = null,
): ProviderAuthStatus => ({
  authenticated: Boolean(payload.authenticated),
  email: payload.email ?? null,
  method: payload.method ?? null,
  error: payload.error ?? fallbackError,
  loading: false,
  // Only the Claude provider ever sends this, and only while a key is bypassing
  // a valid subscription login; keep the key absent otherwise so the shape
  // matches the initial/error statuses above.
  ...(payload.subscriptionOverride ? { subscriptionOverride: payload.subscriptionOverride } : {}),
  // Servers older than this field leave it out; keep it absent rather than
  // claiming the version is unknown.
  ...(payload.installedVersion !== undefined ? { installedVersion: payload.installedVersion } : {}),
});

type UseProviderAuthStatusOptions = {
  initialLoading?: boolean;
};

/**
 * Hook managing authentication statuses for built-in and plugin providers.
 *
 * @param options - Hook configuration options.
 * @returns Provider auth status map, check method, and bulk refresh method.
 */
export function useProviderAuthStatus(
  { initialLoading = true }: UseProviderAuthStatusOptions = {},
) {
  const [providerAuthStatus, setProviderAuthStatus] = useState<ProviderAuthStatusMap>(() => (
    createInitialProviderAuthStatusMap(initialLoading)
  ));

  /**
   * Sets the loading flag for a provider's auth status.
   *
   * @param provider - Provider ID to set as loading.
   */
  const setProviderLoading = useCallback((provider: LLMProvider) => {
    setProviderAuthStatus((previous) => ({
      ...previous,
      [provider]: {
        ...previous[provider],
        loading: true,
        error: null,
      },
    }));
  }, []);

  /**
   * Updates the resolved auth status for a provider.
   *
   * @param provider - Provider ID to update.
   * @param status - Resolved ProviderAuthStatus.
   */
  const setProviderStatus = useCallback((provider: LLMProvider, status: ProviderAuthStatus) => {
    setProviderAuthStatus((previous) => ({
      ...previous,
      [provider]: status,
    }));
  }, []);

  const requestGenerationsRef = useRef<Record<string, number>>({});

  /**
   * Checks the authentication status for a single provider.
   *
   * @param provider - Provider ID to check.
   * @returns Promise resolving to the provider's auth status.
   */
  const checkProviderAuthStatus = useCallback(async (provider: LLMProvider): Promise<ProviderAuthStatus> => {
    const generation = (requestGenerationsRef.current[provider] ?? 0) + 1;
    requestGenerationsRef.current[provider] = generation;

    setProviderLoading(provider);

    try {
      const response = await api.providers.authStatus(provider);

      if (!response.ok) {
        const status: ProviderAuthStatus = {
          authenticated: false,
          email: null,
          method: null,
          loading: false,
          error: FALLBACK_STATUS_ERROR,
        };
        if (requestGenerationsRef.current[provider] === generation) {
          setProviderStatus(provider, status);
        }
        return status;
      }

      const payload = (await response.json()) as ProviderAuthStatusApiResponse;
      const status = toProviderAuthStatus(payload.data);
      if (requestGenerationsRef.current[provider] === generation) {
        setProviderStatus(provider, status);
      }
      return status;
    } catch (caughtError) {
      console.error(`Error checking ${provider} auth status:`, caughtError);
      const status: ProviderAuthStatus = {
        authenticated: false,
        email: null,
        method: null,
        loading: false,
        error: toErrorMessage(caughtError),
      };
      if (requestGenerationsRef.current[provider] === generation) {
        setProviderStatus(provider, status);
      }
      return status;
    }
  }, [setProviderLoading, setProviderStatus]);

  /**
   * Refreshes authentication statuses for a list of providers (defaults to all providers).
   *
   * @param providers - Array of LLMProvider IDs to refresh.
   */
  const refreshProviderAuthStatuses = useCallback(async (providers: LLMProvider[] = withPluginProviderIds(CLI_PROVIDERS)) => {
    await Promise.all(providers.map((provider) => checkProviderAuthStatus(provider)));
  }, [checkProviderAuthStatus]);

  const pluginProviders = usePluginProviders();
  const pluginProviderIds = useMemo(
    () => pluginProviders.map((p) => p.id),
    [pluginProviders],
  );

  const prevPluginIdsRef = useRef<string>('');
  useEffect(() => {
    const key = pluginProviderIds.join(',');
    if (key !== prevPluginIdsRef.current) {
      prevPluginIdsRef.current = key;
      if (pluginProviderIds.length > 0) {
        void refreshProviderAuthStatuses(pluginProviderIds);
      }
    }
  }, [pluginProviderIds, refreshProviderAuthStatuses]);

  return {
    providerAuthStatus,
    checkProviderAuthStatus,
    refreshProviderAuthStatuses,
  };
}
