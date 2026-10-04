import { api } from '@/shared/api';
import { ALL_PROVIDERS } from '@/shared/constants';
import type { LLMProvider } from '@/shared/types';

/**
 * The providers the UI offers for new chats, as configured on the server by
 * `VITE_ENABLED_PROVIDERS`, in the configured order. The first one is the
 * default provider of a new chat.
 *
 * The server owns the value and reads it at runtime: npm installs ship a
 * prebuilt bundle, so `import.meta.env` would only ever hold the value the
 * package was built with. The build-time variable is deliberately not read
 * here, so the two can never disagree.
 *
 * Only lists for new work are filtered. Sessions made with a provider that has
 * since been disabled stay visible and can still be continued.
 */

// Every provider until the server answers, and whenever it cannot: a failed
// request must leave the UI as it was before this setting existed.
let enabledProviders: readonly LLMProvider[] = ALL_PROVIDERS;

const listeners = new Set<() => void>();

/**
 * Keeps known ids only, without repeats, in the server's order. Returns null
 * for anything that is not a usable list, so the caller keeps what it has.
 */
function toProviderList(value: unknown): LLMProvider[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const providers: LLMProvider[] = [];
  for (const entry of value) {
    const provider = ALL_PROVIDERS.find((knownProvider) => knownProvider === entry);
    if (provider && !providers.includes(provider)) {
      providers.push(provider);
    }
  }
  return providers.length > 0 ? providers : null;
}

/**
 * Used by the shared selectedProvider store and useEnabledProviders hook to
 * read the current list synchronously. Never empty; the reference only changes
 * when the list does.
 */
export function readEnabledProviders(): readonly LLMProvider[] {
  return enabledProviders;
}

/** Used by the shared useEnabledProviders hook to re-render when the list changes. */
export function subscribeToEnabledProviders(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Used by the auth module to load the list once the user is known, before the
 * app is shown, so a disabled provider is never painted and then removed.
 * Never rejects: on failure every provider stays offered.
 */
export async function hydrateEnabledProviders(): Promise<void> {
  try {
    const response = await api.providers.enabled();
    if (!response.ok) {
      return;
    }

    const body = (await response.json()) as { data?: { providers?: unknown } };
    const nextProviders = toProviderList(body.data?.providers);
    if (!nextProviders || nextProviders.join() === enabledProviders.join()) {
      return;
    }

    enabledProviders = nextProviders;
    for (const listener of listeners) {
      listener();
    }
  } catch (error) {
    console.error('Failed to load the enabled providers:', error);
  }
}
