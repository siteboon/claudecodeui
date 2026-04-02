import type { CliProvider } from '../../provider-auth/types';

export type { CliProvider };

export type ProviderAuthStatus = {
  authenticated: boolean;
  email: string | null;
  loading: boolean;
  error: string | null;
};

export type ProviderStatusMap = Record<CliProvider, ProviderAuthStatus>;
