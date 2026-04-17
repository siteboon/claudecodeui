import { providerRegistry } from '@/modules/providers/provider.registry.js';
import type {
  FetchHistoryOptions,
  FetchHistoryResult,
  LLMProvider,
  NormalizedMessage,
} from '@/shared/types.js';

/**
 * Application service for provider message operations.
 *
 * Callers pass a provider id and this service resolves the concrete provider
 * class, keeping normalization/history call sites decoupled from implementation
 * file layout.
 */
export const providersService = {
  listProviderIds(): LLMProvider[] {
    return providerRegistry.listProviders().map((provider) => provider.id);
  },

  normalizeMessage(
    providerName: string,
    raw: unknown,
    sessionId: string | null,
  ): NormalizedMessage[] {
    return providerRegistry.resolveProvider(providerName).normalizeMessage(raw, sessionId);
  },

  fetchHistory(
    providerName: string,
    sessionId: string,
    options?: FetchHistoryOptions,
  ): Promise<FetchHistoryResult> {
    return providerRegistry.resolveProvider(providerName).fetchHistory(sessionId, options);
  },
};
