import { AntigravityProvider } from '@/modules/providers/list/antigravity/antigravity.provider.js';
import { ClaudeProvider } from '@/modules/providers/list/claude/claude.provider.js';
import { CodexProvider } from '@/modules/providers/list/codex/codex.provider.js';
import { CursorProvider } from '@/modules/providers/list/cursor/cursor.provider.js';
import { OpenCodeProvider } from '@/modules/providers/list/opencode/opencode.provider.js';
import type { IProvider } from '@/shared/interfaces.js';
import type { LLMProvider } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

let providers: Record<LLMProvider, IProvider> | null = null;

function getProviders(): Record<LLMProvider, IProvider> {
  if (!providers) {
    providers = {
      claude: new ClaudeProvider(),
      codex: new CodexProvider(),
      cursor: new CursorProvider(),
      opencode: new OpenCodeProvider(),
      antigravity: new AntigravityProvider(),
    };
  }
  return providers;
}

/**
 * Central registry for resolving concrete provider implementations by id.
 */
export const providerRegistry = {
  listProviders(): IProvider[] {
    return Object.values(getProviders());
  },

  resolveProvider(provider: string): IProvider {
    const key = provider as LLMProvider;
    const resolvedProvider = getProviders()[key];
    if (!resolvedProvider) {
      throw new AppError(`Unsupported provider "${provider}".`, {
        code: 'UNSUPPORTED_PROVIDER',
        statusCode: 400,
      });
    }

    return resolvedProvider;
  },
};
