import { getPluginProvider } from '@/shared/providerRegistry';
import type { LLMProvider } from '@/shared/types';
import { readUserPreference, writeUserPreference } from '@/shared/userSettings';

/**
 * The provider the user last chose, shared by chat, the shell, the git panel and
 * the project workspace.
 *
 * It was read from localStorage in six places with four different hand-rolled
 * readers — only one of which validated the stored string — and written from
 * three modules. Nothing published a same-tab change, so the git panel's reader
 * (which listens only for the cross-tab `storage` event) never saw a switch made
 * in its own tab.
 *
 * The value now lives in `auth.db` through the preference store, which notifies
 * its subscribers synchronously — including in the tab that wrote — so the
 * choice both reaches every reader at once and follows the user between devices.
 */

const PROVIDERS: LLMProvider[] = ['claude', 'cursor', 'codex', 'opencode'];

const DEFAULT_PROVIDER: LLMProvider = 'claude';

/**
 * Reads the active selected provider from persisted user preferences,
 * validating against both built-in providers and registered plugin providers.
 *
 * @returns The selected LLMProvider, falling back to DEFAULT_PROVIDER ('claude').
 */
export function readSelectedProvider(): LLMProvider {
  const stored = readUserPreference<string | null>('selectedProvider', null);
  return PROVIDERS.includes(stored as LLMProvider) || getPluginProvider(stored)
    ? (stored as LLMProvider)
    : DEFAULT_PROVIDER;
}

/**
 * Persists the user's selected provider to preferences.
 *
 * @param provider - The LLMProvider to set as active.
 */
export function writeSelectedProvider(provider: LLMProvider): void {
  writeUserPreference('selectedProvider', provider);
}
