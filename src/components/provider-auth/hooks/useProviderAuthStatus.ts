import { useCallback, useState } from 'react';
import { authenticatedFetch } from '../../../utils/api';
import type { LLMProvider } from '../../../types/app';
import {
  CLI_PROVIDERS,
  PROVIDER_AUTH_STATUS_ENDPOINTS,
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
  isBedrock?: boolean;
  error?: string | null;
};

type ProviderAuthStatusApiResponse = {
  success: boolean;
  data: ProviderAuthStatusPayload;
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
  isBedrock: Boolean(payload.isBedrock),
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

  const checkProviderAuthStatus = useCallback(async (provider: LLMProvider): Promise<ProviderAuthStatus> => {
    setProviderLoading(provider);

    try {
      const response = await authenticatedFetch(PROVIDER_AUTH_STATUS_ENDPOINTS[provider]);

      if (!response.ok) {
        const status: ProviderAuthStatus = {
          authenticated: false,
          email: null,
          method: null,
          loading: false,
          error: FALLBACK_STATUS_ERROR,
        };
        setProviderStatus(provider, status);
        return status;
      }

      const payload = (await response.json()) as ProviderAuthStatusApiResponse;
      const status = toProviderAuthStatus(payload.data);
      setProviderStatus(provider, status);
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
      setProviderStatus(provider, status);
      return status;
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
