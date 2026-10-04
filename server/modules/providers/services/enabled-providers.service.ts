import { providerRegistry } from '@/modules/providers/provider.registry.js';
import type { LLMProvider } from '@/shared/types.js';
import { terminalTextStyles } from '@/shared/utils.js';

/**
 * Which providers the UI offers for new chats, from `VITE_ENABLED_PROVIDERS`.
 *
 * Read on the server at runtime rather than baked into the frontend bundle at
 * build time: npm installs ship a prebuilt `dist/`, so a build-time value would
 * never reach most users. The `VITE_` prefix is kept so the variable sits next
 * to the other `VITE_*` settings in `.env`.
 *
 * This only decides what the UI lists. It is not an access control: the chat,
 * agent and session APIs still accept every provider.
 */

type ParsedProviderList = {
  /** Known providers in the order they were listed, without repeats. */
  listedProviders: LLMProvider[];
  /** Listed ids that name no provider, lower-cased and without repeats. */
  unknownIds: string[];
};

/**
 * Splits a comma-separated provider list. Ids are trimmed and
 * case-insensitive, and a repeated id keeps the place of its first occurrence.
 */
function parseProviderList(
  rawValue: string | undefined,
  knownProviders: readonly LLMProvider[],
): ParsedProviderList {
  const listedProviders: LLMProvider[] = [];
  const unknownIds: string[] = [];

  for (const entry of (rawValue ?? '').split(',')) {
    const id = entry.trim().toLowerCase();
    if (!id) {
      continue;
    }

    const provider = knownProviders.find((knownProvider) => knownProvider === id);
    if (!provider) {
      if (!unknownIds.includes(id)) {
        unknownIds.push(id);
      }
    } else if (!listedProviders.includes(provider)) {
      listedProviders.push(provider);
    }
  }

  return { listedProviders, unknownIds };
}

// The raw value the cached list was parsed from. The cache is keyed on it
// rather than filled once so tests can change the variable; in a running
// server it never changes, which keeps the warning from repeating per request.
let parsedRawValue: string | undefined;
let cachedEnabledProviders: LLMProvider[] | null = null;

/**
 * Used by the providers routes (`GET /api/providers/enabled`) to tell the UI
 * which providers to list, and by the server bootstrap so a misconfigured
 * value is reported at startup rather than on the first page load.
 */
export const enabledProvidersService = {
  /**
   * Returns the enabled providers, first one being the default for a new chat.
   *
   * An unset, empty or all-unknown value enables every provider, so a typo can
   * never leave the UI with nothing to offer. Unknown ids are reported once.
   */
  getEnabledProviders(): LLMProvider[] {
    const rawValue = process.env.VITE_ENABLED_PROVIDERS;
    if (cachedEnabledProviders && rawValue === parsedRawValue) {
      return [...cachedEnabledProviders];
    }

    const knownProviders = providerRegistry.listProviders().map((provider) => provider.id);
    const { listedProviders, unknownIds } = parseProviderList(rawValue, knownProviders);
    const enabledProviders = listedProviders.length > 0 ? listedProviders : knownProviders;

    if (unknownIds.length > 0) {
      const fallbackNote = listedProviders.length === 0
        ? ' None of the listed ids is a provider, so every provider stays enabled.'
        : '';
      console.warn(
        `${terminalTextStyles.warn('[WARN]')} VITE_ENABLED_PROVIDERS: ignoring unknown provider(s) `
        + `${unknownIds.join(', ')} (known: ${knownProviders.join(', ')}).${fallbackNote}`,
      );
    }
    if (listedProviders.length > 0) {
      console.log(
        `${terminalTextStyles.info('[INFO]')} VITE_ENABLED_PROVIDERS: the UI offers ${listedProviders.join(', ')}`,
      );
    }

    parsedRawValue = rawValue;
    cachedEnabledProviders = enabledProviders;
    return [...enabledProviders];
  },
};
