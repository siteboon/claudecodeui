import type { LLMProvider } from '@/shared/types';
import { ALL_PROVIDERS } from '@/shared/constants';
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
 * Chat stores the open session's provider here, so a provider the server no
 * longer enables (VITE_ENABLED_PROVIDERS) still reads as stored: while a session
 * made with one is open, every reader must agree with that session. Only a new
 * chat is held to the enabled providers, through readNewChatProvider(). Nothing
 * stored, or an id that names no provider, reads as the default: the first
 * enabled provider.
 */

const isKnownProvider = (value: unknown): value is LLMProvider => (
  ALL_PROVIDERS.includes(value as LLMProvider)
);

// The provider of the session the chat view has open, or null on the new-chat
// state. reconcileSelectedProvider() can run after the user's preferences load,
// which may be after such a session was opened, so it must leave this one alone.
let openSessionProvider: LLMProvider | null = null;

/**
 * Used by the chat module: records the provider of the open session (null when
 * none is open), so a late reconcile does not move storage off that session.
 */
export function setOpenSessionProvider(provider: LLMProvider | null): void {
  openSessionProvider = provider;
}

export function readSelectedProvider(): LLMProvider {
  const stored = readUserPreference<string | null>('selectedProvider', null);
  return isKnownProvider(stored) ? stored : readEnabledProviders()[0];
}

export function writeSelectedProvider(provider: LLMProvider): void {
  writeUserPreference('selectedProvider', provider);
}

/**
 * Used by the chat module once no session is open, and by
 * reconcileSelectedProvider: the provider a new chat starts on. That is the
 * stored provider when the server enables it, else `preferred` when the server
 * enables that, else the first enabled provider.
 */
export function readNewChatProvider(preferred: LLMProvider | null = null): LLMProvider {
  const enabledProviders = readEnabledProviders();
  const selectedProvider = readSelectedProvider();
  if (enabledProviders.includes(selectedProvider)) {
    return selectedProvider;
  }
  return preferred && enabledProviders.includes(preferred) ? preferred : enabledProviders[0];
}

/**
 * Used by the auth module after the enabled providers and the user's
 * preferences load: rewrites a stored provider that is no longer enabled to the
 * one a new chat starts on, so the copy in `auth.db` agrees with what the app
 * opens on. Only a provider the server disabled is rewritten: nothing stored,
 * or an id that names no provider, already reads as the default, so with every
 * provider enabled nothing is ever written, as before the setting existed. The
 * provider of an open session is kept, since every reader follows that session.
 */
export function reconcileSelectedProvider(): void {
  const stored = readUserPreference<string | null>('selectedProvider', null);
  if (isKnownProvider(stored) && !readEnabledProviders().includes(stored) && stored !== openSessionProvider) {
    writeSelectedProvider(readNewChatProvider());
  }
}
