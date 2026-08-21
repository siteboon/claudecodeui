import type { LLMProvider } from '@/shared/types';

/**
 * The provider the user last chose, shared by chat, the shell, the git panel and
 * the project workspace.
 *
 * It was read from localStorage in six places with four different hand-rolled
 * readers — only one of which validated the stored string — and written from
 * three modules. Nothing published a same-tab change, so the git panel's reader
 * (which listens only for the cross-tab `storage` event) never saw a switch made
 * in its own tab.
 */

const SELECTED_PROVIDER_STORAGE_KEY = 'selected-provider';

/** Emitted on write, because `storage` does not fire in the writing tab. */
export const SELECTED_PROVIDER_CHANGED_EVENT = 'selected-provider:changed';

const PROVIDERS: LLMProvider[] = ['claude', 'cursor', 'codex', 'opencode'];

const DEFAULT_PROVIDER: LLMProvider = 'claude';

export function readSelectedProvider(): LLMProvider {
  const stored = localStorage.getItem(SELECTED_PROVIDER_STORAGE_KEY);
  return PROVIDERS.includes(stored as LLMProvider) ? (stored as LLMProvider) : DEFAULT_PROVIDER;
}

export function writeSelectedProvider(provider: LLMProvider): void {
  localStorage.setItem(SELECTED_PROVIDER_STORAGE_KEY, provider);
  window.dispatchEvent(new Event(SELECTED_PROVIDER_CHANGED_EVENT));
}

/** True when a `storage` event describes a change to this key. */
export function isSelectedProviderStorageEvent(event: StorageEvent): boolean {
  return event.key === SELECTED_PROVIDER_STORAGE_KEY;
}
