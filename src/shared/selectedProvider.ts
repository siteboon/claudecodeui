import type { LLMProvider } from '@/shared/types';
import { readEnabledProviders } from '@/shared/enabledProviders';
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
 *
 * A stored provider the server no longer enables (VITE_ENABLED_PROVIDERS) reads
 * as the first enabled one, which is also the default when nothing is stored.
 */

export function readSelectedProvider(): LLMProvider {
  const enabledProviders = readEnabledProviders();
  const stored = readUserPreference<string | null>('selectedProvider', null);
  return enabledProviders.includes(stored as LLMProvider) ? (stored as LLMProvider) : enabledProviders[0];
}

export function writeSelectedProvider(provider: LLMProvider): void {
  writeUserPreference('selectedProvider', provider);
}

/**
 * Used by the auth module after the enabled providers and the user's
 * preferences load: rewrites a stored provider that is no longer enabled to the
 * one it now reads as, so the copy in `auth.db` agrees with what every reader
 * sees. Nothing is written when nothing is stored.
 */
export function reconcileSelectedProvider(): void {
  const stored = readUserPreference<string | null>('selectedProvider', null);
  const selectedProvider = readSelectedProvider();
  if (stored !== null && stored !== selectedProvider) {
    writeSelectedProvider(selectedProvider);
  }
}
