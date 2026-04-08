import type { LLMProvider } from '@/shared/types/app.js';

/**
 * Provider authentication status normalized for frontend consumption.
 */
export type ProviderAuthStatus = {
  provider: LLMProvider;
  authenticated: boolean;
  email: string | null;
  method: string | null;
  error?: string;
};

/**
 * Auth runtime contract for one provider.
 */
export interface IProviderAuthRuntime {
  getStatus(): Promise<ProviderAuthStatus>;
}
