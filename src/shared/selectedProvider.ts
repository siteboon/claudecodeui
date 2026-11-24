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

const PROVIDERS: LLMProvider[] = ['claude', 'cursor', 'codex', 'opencode', 'antigravity'];

const DEFAULT_PROVIDER: LLMProvider = 'claude';

/**
 * Providers that reported a working login during this page load, in the order
 * the app probes them. Null until the first probe finishes, which is what
 * keeps the stored choice authoritative until a real answer exists.
 */
let authenticatedProviders: LLMProvider[] | null = null;

/**
 * Records which providers are logged in. Called once per page load by the chat
 * state hook; earlier callers are simply ignored, since a later probe is the
 * more accurate one.
 */
export function primeAuthenticatedProviders(providers: LLMProvider[]): void {
  authenticatedProviders = [...providers];
}

export function readSelectedProvider(): LLMProvider {
  const stored = readUserPreference<string | null>('selectedProvider', null);
  const candidate = PROVIDERS.includes(stored as LLMProvider)
    ? (stored as LLMProvider)
    : DEFAULT_PROVIDER;

  // A stored choice is only usable if that CLI is actually logged in. Without
  // this, a fresh install sends the first turn to an uninstalled CLI and the
  // chat fails before the user has picked anything.
  if (authenticatedProviders && authenticatedProviders.length > 0
    && !authenticatedProviders.includes(candidate)) {
    return authenticatedProviders[0];
  }

  return candidate;
}

/**
 * Records the chosen provider.
 *
 * `explicit` marks a choice the user made (the picker, a login) as opposed to
 * one the app mirrored from a session it navigated to. An explicit choice
 * outranks the page-load probe for the rest of the page load: a provider the
 * user just logged into may not appear in that snapshot, and silently
 * switching back would make the login look like it did not take. A mirrored
 * choice does not, so opening a session of an uninstalled CLI cannot drag the
 * next new chat back onto it.
 */
export function writeSelectedProvider(
  provider: LLMProvider,
  { explicit = true }: { explicit?: boolean } = {},
): void {
  if (explicit) {
    authenticatedProviders = null;
  }
  writeUserPreference('selectedProvider', provider);
}
