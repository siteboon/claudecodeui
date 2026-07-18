import { claudeRuntime } from '@/modules/providers/list/claude/claude-runtime.provider.js';
import { codexRuntime } from '@/modules/providers/list/codex/codex-runtime.provider.js';
import { cursorRuntime } from '@/modules/providers/list/cursor/cursor-runtime.provider.js';
import { opencodeRuntime } from '@/modules/providers/list/opencode/opencode-runtime.provider.js';
import type { IProviderRuntime } from '@/shared/interfaces.js';
import type { LLMProvider } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

const runtimes: Record<LLMProvider, IProviderRuntime> = {
  claude: claudeRuntime,
  codex: codexRuntime,
  cursor: cursorRuntime,
  opencode: opencodeRuntime,
};

/**
 * Central registry for stateful SDK/CLI execution adapters.
 *
 * This is separate from `providerRegistry` because runtimes consume services
 * backed by that registry. Keeping the dependency one-way avoids a provider ->
 * runtime -> service -> provider registry import cycle.
 */
export const providerRuntimeRegistry = {
  hasRuntime(provider: string): boolean {
    return Object.hasOwn(runtimes, provider);
  },

  listRuntimes(): IProviderRuntime[] {
    return Object.values(runtimes);
  },

  resolveRuntime(provider: string): IProviderRuntime {
    const runtime = runtimes[provider as LLMProvider];
    if (!runtime) {
      throw new AppError(`Unsupported provider runtime "${provider}".`, {
        code: 'UNSUPPORTED_PROVIDER_RUNTIME',
        statusCode: 400,
      });
    }

    return runtime;
  },
};
