import { useCallback, useState } from 'react';
import { authenticatedFetch } from '../../../utils/api';
import type { LLMProvider } from '../../../types/app';
import {
  CLI_AUTH_STATUS_ENDPOINTS,
  CLI_PROVIDERS,
  createInitialProviderAuthStatusMap,
} from '../types';
import type {
  ProviderAuthStatus,
  ProviderAuthStatusMap,
} from '../types';

type ProviderAuthStatusPayload = {
  authenticated?: boolean;
  email?: string | null;
  method?: string | null;
  error?: string | null;
};

const FALLBACK_STATUS_ERROR = 'Failed to check authentication status';
const FALLBACK_UNKNOWN_ERROR = 'Unknown error';

const toErrorMessage = (error: unknown): string => (
  error instanceof Error ? error.message : FALLBACK_UNKNOWN_ERROR
);

const toProviderAuthStatus = (
  payload: ProviderAuthStatusPayload,
  fallbackError: string | null = null,
): ProviderAuthStatus => ({
  authenticated: Boolean(payload.authenticated),
  email: payload.email ?? null,
  method: payload.method ?? null,
  error: payload.error ?? fallbackError,
  loading: false,
});

type UseProviderAuthStatusOptions = {
  initialLoading?: boolean;
};

export function useProviderAuthStatus(
  { initialLoading = true }: UseProviderAuthStatusOptions = {},
) {
  const [providerAuthStatus, setProviderAuthStatus] = useState<ProviderAuthStatusMap>(() => (
    createInitialProviderAuthStatusMap(initialLoading)
  ));

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

  const setProviderStatus = useCallback((provider: LLMProvider, status: ProviderAuthStatus) => {
    setProviderAuthStatus((previous) => ({
      ...previous,
      [provider]: status,
    }));
  }, []);

  const checkProviderAuthStatus = useCallback(async (provider: LLMProvider) => {
    setProviderLoading(provider);

    try {
      const response = await authenticatedFetch(CLI_AUTH_STATUS_ENDPOINTS[provider]);

      if (!response.ok) {
        setProviderStatus(provider, {
          authenticated: false,
          email: null,
          method: null,
          loading: false,
          error: FALLBACK_STATUS_ERROR,
        });
        return;
      }

      const payload = (await response.json()) as ProviderAuthStatusPayload;
      setProviderStatus(provider, toProviderAuthStatus(payload));
    } catch (caughtError) {
      console.error(`Error checking ${provider} auth status:`, caughtError);
      setProviderStatus(provider, {
        authenticated: false,
        email: null,
        method: null,
        loading: false,
        error: toErrorMessage(caughtError),
      });
    }
  }, [setProviderLoading, setProviderStatus]);

  const refreshProviderAuthStatuses = useCallback(async (providers: LLMProvider[] = CLI_PROVIDERS) => {
    await Promise.all(providers.map((provider) => checkProviderAuthStatus(provider)));
  }, [checkProviderAuthStatus]);

  return {
    providerAuthStatus,
    setProviderAuthStatus,
    checkProviderAuthStatus,
    refreshProviderAuthStatuses,
  };
}
