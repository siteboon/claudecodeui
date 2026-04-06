import type { IProvider } from '@/modules/llm/providers/provider.interface.js';
import { ClaudeProvider } from '@/modules/llm/providers/claude.provider.js';
import { CodexProvider } from '@/modules/llm/providers/codex.provider.js';
import { CursorProvider } from '@/modules/llm/providers/cursor.provider.js';
import { GeminiProvider } from '@/modules/llm/providers/gemini.provider.js';
import type { LLMProvider } from '@/shared/types/app.js';
import { AppError } from '@/shared/utils/app-error.js';

const providers: Record<LLMProvider, IProvider> = {
  claude: new ClaudeProvider(),
  codex: new CodexProvider(),
  cursor: new CursorProvider(),
  gemini: new GeminiProvider(),
};

/**
 * Central registry for resolving provider implementations by id.
 */
export const llmProviderRegistry = {
  /**
   * Returns all registered providers.
   */
  listProviders(): IProvider[] {
    return Object.values(providers);
  },

  /**
   * Resolves one provider or throws a typed 400 error.
   */
  resolveProvider(provider: string): IProvider {
    const key = provider as LLMProvider;
    const resolvedProvider = providers[key];
    if (!resolvedProvider) {
      throw new AppError(`Unsupported provider "${provider}".`, {
        code: 'UNSUPPORTED_PROVIDER',
        statusCode: 400,
      });
    }

    return resolvedProvider;
  },
};
