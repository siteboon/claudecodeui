import { useCallback, useState } from 'react';

import { api } from '@/shared/api';
import type { LLMProvider, ProviderAuthStatus, ProviderAuthStatusMap } from '@/shared/types';

const CLI_PROVIDERS: LLMProvider[] = ['claude', 'cursor', 'codex', 'opencode'];

const createInitialProviderAuthStatus = (loading = true) => ({
  installed: false,
  authenticated: false,
  email: null,
  method: null,
  error: null,
  loginCommand: null,
  loading,
});

const createInitialProviderAuthStatusMap = (loading = true): ProviderAuthStatusMap => ({
  claude: createInitialProviderAuthStatus(loading),
  cursor: createInitialProviderAuthStatus(loading),
  codex: createInitialProviderAuthStatus(loading),
  opencode: createInitialProviderAuthStatus(loading),
  zcode: createInitialProviderAuthStatus(loading),
  antigravity: createInitialProviderAuthStatus(loading),
});

type ProviderAuthStatusPayload = {
  installed?: boolean;
  authenticated?: boolean;
  email?: string | null;
  method?: string | null;
  error?: string | null;
  loginCommand?: string | null;
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
  installed: payload.installed !== false,
  authenticated: Boolean(payload.authenticated),
  email: payload.email ?? null,
  method: payload.method ?? null,
  error: payload.error ?? fallbackError,
  loginCommand: payload.loginCommand ?? null,
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
      const response = await api.providers.authStatus(provider);

      if (!response.ok) {
        const status: ProviderAuthStatus = {
          installed: true,
          authenticated: false,
          email: null,
          method: null,
          loginCommand: null,
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
        installed: true,
        authenticated: false,
        email: null,
        method: null,
        loginCommand: null,
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
    checkProviderAuthStatus,
    refreshProviderAuthStatuses,
  };
}
