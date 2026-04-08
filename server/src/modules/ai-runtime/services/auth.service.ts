import { llmProviderRegistry } from '@/modules/ai-runtime/ai-runtime.registry.js';
import type { ProviderAuthStatus } from '@/modules/ai-runtime/types/index.js';

export const llmAuthService = {
  /**
   * Returns auth status for one provider.
   */
  async getProviderAuthStatus(providerName: string): Promise<ProviderAuthStatus> {
    const provider = llmProviderRegistry.resolveProvider(providerName);
    return provider.auth.getStatus();
  },
};
