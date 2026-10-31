import { ClaudeProvider } from '@/modules/providers/list/claude/claude.provider.js';
import { CodexProvider } from '@/modules/providers/list/codex/codex.provider.js';
import { CursorProvider } from '@/modules/providers/list/cursor/cursor.provider.js';
import { OpenCodeProvider } from '@/modules/providers/list/opencode/opencode.provider.js';
import { pluginProvidersStore } from '@/modules/providers/plugin-providers.store.js';
import type { IProvider } from '@/shared/interfaces.js';
import type { LLMProvider } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

const providers: Record<LLMProvider, IProvider> = {
  claude: new ClaudeProvider(),
  codex: new CodexProvider(),
  cursor: new CursorProvider(),
  opencode: new OpenCodeProvider(),
};

/**
 * Central registry for resolving concrete provider implementations by id.
 */
export const providerRegistry = {
  listProviders(): IProvider[] {
    // Plugin providers (provider-plugin-loader.ts) come after the built-ins.
    return [...Object.values(providers), ...pluginProvidersStore.list().map((entry) => entry.provider)];
  },

  hasProvider(provider: string): boolean {
    return Object.hasOwn(providers, provider) || Boolean(pluginProvidersStore.get(provider));
  },

  resolveProvider(provider: string): IProvider {
    const key = provider as LLMProvider;
    const resolvedProvider = (Object.hasOwn(providers, key) ? providers[key] : undefined)
      ?? pluginProvidersStore.get(provider)?.provider;
    if (!resolvedProvider) {
      throw new AppError(`Unsupported provider "${provider}".`, {
        code: 'UNSUPPORTED_PROVIDER',
        statusCode: 400,
      });
    }

    return resolvedProvider;
  },
};
