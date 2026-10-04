import { useSyncExternalStore } from 'react';

import { readEnabledProviders, subscribeToEnabledProviders } from '@/shared/enabledProviders';
import type { LLMProvider } from '@/shared/types';

/**
 * Used by the chat, settings and onboarding modules to list only the providers
 * the server enables (VITE_ENABLED_PROVIDERS) wherever a new chat or login is
 * offered. The first entry is the default provider.
 */
export function useEnabledProviders(): readonly LLMProvider[] {
  return useSyncExternalStore(subscribeToEnabledProviders, readEnabledProviders);
}
