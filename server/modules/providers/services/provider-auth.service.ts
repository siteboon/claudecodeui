import { providerRegistry } from '@/modules/providers/provider.registry.js';
import type { LLMProvider, ProviderAuthStatus, ProviderUsageSnapshot } from '@/shared/types.js';

type UsageCapableAuth = {
  getUsage: (opts?: { force?: boolean }) => Promise<ProviderUsageSnapshot>;
};

export const providerAuthService = {
  /**
   * Resolves a provider and returns its installation/authentication status.
   */
  async getProviderAuthStatus(providerName: string): Promise<ProviderAuthStatus> {
    const provider = providerRegistry.resolveProvider(providerName);
    return provider.auth.getStatus();
  },

  /**
   * Returns whether a provider runtime appears installed.
   * Falls back to true if status lookup itself fails so callers preserve the
   * original runtime error instead of replacing it with a status-check failure.
   */
  async isProviderInstalled(providerName: LLMProvider): Promise<boolean> {
    try {
      const status = await this.getProviderAuthStatus(providerName);
      return status.installed;
    } catch {
      return true;
    }
  },

  /**
   * Returns a rate-limit + identity snapshot for a provider. Only providers
   * whose auth implementations expose `getUsage` support this (currently
   * claude and codex). The caller guards which providers can be passed in.
   */
  async getProviderUsage(
    providerName: 'claude' | 'codex',
    opts?: { force?: boolean },
  ): Promise<ProviderUsageSnapshot> {
    const provider = providerRegistry.resolveProvider(providerName);
    return (provider.auth as unknown as UsageCapableAuth).getUsage(opts);
  },
};
