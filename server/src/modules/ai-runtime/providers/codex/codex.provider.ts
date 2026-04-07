import os from 'node:os';
import path from 'node:path';
import { readFile } from 'node:fs/promises';

import { BaseSdkProvider } from '@/modules/ai-runtime/providers/base/base-sdk.provider.js';
import type {
  IProviderMcpRuntime,
  IProviderSessionSynchronizerRuntime,
  IProviderSkillsRuntime,
  ProviderModel,
  ProviderSessionEvent,
  StartSessionInput,
} from '@/modules/ai-runtime/types/index.js';
import { CodexMcpRuntime } from '@/modules/ai-runtime/providers/codex/codex-mcp.runtime.js';
import { CodexSkillsRuntime } from '@/modules/ai-runtime/providers/codex/codex-skills.runtime.js';
import { CodexSessionSynchronizerRuntime } from '@/modules/ai-runtime/providers/codex/codex-session-synchronizer.runtime.js';
import { AppError } from '@/shared/utils/app-error.js';

type CodexExecutionInput = StartSessionInput & {
  sessionId: string;
  isResume: boolean;
};

type CodexModelCacheEntry = {
  slug?: string;
  display_name?: string;
  description?: string;
  supported_reasoning_levels?: Array<{
    effort?: string;
    description?: string;
  }>;
  priority?: number;
};

type CodexSdkClient = {
  startThread: (options?: Record<string, unknown>) => CodexThread;
  resumeThread: (sessionId: string, options?: Record<string, unknown>) => CodexThread;
};

type CodexThread = {
  runStreamed: (
    prompt:
      | string
      | Array<
          | {
              type: 'text';
              text: string;
            }
          | {
              type: 'local_image';
              path: string;
            }
        >,
    options?: {
      signal?: AbortSignal;
    },
  ) => Promise<{
    events: AsyncIterable<unknown>;
  }>;
};

type CodexSdkModule = {
  Codex: new () => CodexSdkClient;
};

/**
 * Codex SDK provider implementation.
 */
export class CodexProvider extends BaseSdkProvider {
  readonly mcp: IProviderMcpRuntime = new CodexMcpRuntime();
  readonly skills: IProviderSkillsRuntime = new CodexSkillsRuntime();
  readonly sessionSynchronizer: IProviderSessionSynchronizerRuntime = new CodexSessionSynchronizerRuntime();

  private codexClientPromise: Promise<CodexSdkClient> | null = null;

  constructor() {
    super('codex', {
      supportsRuntimePermissionRequests: false,
      supportsThinkingModeControl: true,
    });
  }

  /**
   * Reads codex models from ~/.codex/models_cache.json.
   */
  async listModels(): Promise<ProviderModel[]> {
    const modelCachePath = path.join(os.homedir(), '.codex', 'models_cache.json');
    let content: string;
    try {
      content = await readFile(modelCachePath, 'utf8');
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code === 'ENOENT') {
        throw new AppError('Codex model cache was not found. Expected ~/.codex/models_cache.json.', {
          code: 'CODEX_MODEL_CACHE_NOT_FOUND',
          statusCode: 404,
        });
      }

      throw error;
    }

    const parsed = JSON.parse(content) as { models?: CodexModelCacheEntry[] };

    const models = parsed.models ?? [];
    return models
      .filter((entry) => Boolean(entry.slug))
      .map((entry) => ({
        value: entry.slug as string,
        displayName: entry.display_name ?? entry.slug ?? 'unknown',
        description: entry.description,
        default: entry.priority === 1,
        supportsThinkingModes: Boolean(entry.supported_reasoning_levels?.length),
        supportedThinkingModes: entry.supported_reasoning_levels
          ?.map((level) => level.effort)
          .filter((effort): effort is string => typeof effort === 'string'),
      }));
  }

  /**
   * Creates a Codex thread execution and wires abort support.
   */
  protected async createSdkExecution(input: CodexExecutionInput): Promise<{
    stream: AsyncIterable<unknown>;
    stop: () => Promise<boolean>;
  }> {
    const client = await this.getCodexClient();

    const threadOptions: Record<string, unknown> = {
      model: input.model,
      workingDirectory: input.workspacePath,
      modelReasoningEffort: input.thinkingMode,
    };

    const thread = input.isResume
      ? client.resumeThread(input.sessionId, threadOptions)
      : client.startThread(threadOptions);

    const abortController = new AbortController();
    const promptInput = this.buildPromptInput(input.prompt, input.imagePaths, input.workspacePath);
    const streamedTurn = await thread.runStreamed(promptInput, {
      signal: abortController.signal,
    });

    return {
      stream: streamedTurn.events,
      stop: async () => {
        abortController.abort('Session stop requested');
        return true;
      },
    };
  }

  /**
   * Returns a shared Codex SDK client instance for this provider.
   */
  private async getCodexClient(): Promise<CodexSdkClient> {
    if (!this.codexClientPromise) {
      this.codexClientPromise = this.loadCodexSdkModule()
        .then((sdkModule) => new sdkModule.Codex())
        .catch((error) => {
          this.codexClientPromise = null;
          throw error;
        });
    }

    return this.codexClientPromise;
  }

  /**
   * Builds Codex prompt items. Images are sent as `local_image` entries for SDK-native image support.
   */
  private buildPromptInput(
    prompt: string,
    imagePaths?: string[],
    workspacePath?: string,
  ): string | Array<{ type: 'text'; text: string } | { type: 'local_image'; path: string }> {
    if (!imagePaths || imagePaths.length === 0) {
      return prompt;
    }

    const resolvedImagePaths = imagePaths.map((imagePath) => (
      path.isAbsolute(imagePath)
        ? imagePath
        : path.resolve(workspacePath ?? process.cwd(), imagePath)
    ));

    return [
      { type: 'text', text: prompt },
      ...resolvedImagePaths.map((resolvedPath) => ({
        type: 'local_image' as const,
        path: resolvedPath,
      })),
    ];
  }

  /**
   * Normalizes Codex stream events into the shared event shape.
   */
  protected mapSdkEvent(rawEvent: unknown): ProviderSessionEvent | null {
    if (typeof rawEvent !== 'object' || rawEvent === null) {
      return {
        timestamp: new Date().toISOString(),
        channel: 'sdk',
        message: String(rawEvent),
      };
    }

    const record = rawEvent as Record<string, unknown>;
    const message = typeof record.type === 'string' ? record.type : 'codex_event';

    return {
      timestamp: new Date().toISOString(),
      channel: 'sdk',
      message,
      data: rawEvent,
    };
  }

  /**
   * Dynamically imports the Codex SDK to support environments where it is optional.
   */
  private async loadCodexSdkModule(): Promise<CodexSdkModule> {
    try {
      const sdkModule = (await import('@openai/codex-sdk')) as unknown as CodexSdkModule;
      if (!sdkModule?.Codex) {
        throw new Error('Codex SDK did not export "Codex".');
      }
      return sdkModule;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to import Codex SDK';
      throw new AppError(`Codex SDK is unavailable: ${message}`, {
        code: 'CODEX_SDK_UNAVAILABLE',
        statusCode: 503,
      });
    }
  }
}
