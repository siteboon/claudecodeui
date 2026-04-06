import {
  query,
  type CanUseTool,
  type ModelInfo,
  type Options,
} from '@anthropic-ai/claude-agent-sdk';
import path from 'node:path';
import { readFile } from 'node:fs/promises';

import { BaseSdkProvider } from '@/modules/llm/providers/base-sdk.provider.js';
import type {
  ProviderModel,
  ProviderSessionEvent,
  RuntimePermissionMode,
  StartSessionInput,
} from '@/modules/llm/providers/provider.interface.js';

type ClaudeExecutionInput = StartSessionInput & {
  sessionId: string;
  isResume: boolean;
};

const CLAUDE_THINKING_LEVELS = new Set(['low', 'medium', 'high', 'max']);
const SUPPORTED_CLAUDE_IMAGE_TYPES = new Map<string, 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'>([
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
]);

type ClaudeUserPromptMessage = {
  type: 'user';
  message: {
    role: 'user';
    content: Array<
      | {
          type: 'text';
          text: string;
        }
      | {
          type: 'image';
          source: {
            type: 'base64';
            media_type: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
            data: string;
          };
        }
    >;
  };
  parent_tool_use_id: null;
  timestamp: string;
};

/**
 * Claude SDK provider implementation.
 */
export class ClaudeProvider extends BaseSdkProvider {
  constructor() {
    super('claude', {
      supportsRuntimePermissionRequests: true,
      supportsThinkingModeControl: true,
      supportsModelSwitching: true,
      supportsSessionResume: true,
      supportsSessionStop: true,
    });
  }

  /**
   * Retrieves available Claude models from the SDK.
   */
  async listModels(): Promise<ProviderModel[]> {
    const probe = query({
      prompt: 'model_probe',
      options: {
        permissionMode: 'plan',
      },
    });

    try {
      const models = await probe.supportedModels();
      return models.map((model) => this.mapModelInfo(model));
    } finally {
      probe.close();
    }
  }

  /**
   * Creates a Claude SDK query execution for start/resume flows.
   */
  protected async createSdkExecution(input: ClaudeExecutionInput): Promise<{
    stream: AsyncIterable<unknown>;
    stop: () => Promise<boolean>;
    setModel: (model: string) => Promise<void>;
  }> {
    const options: Options = {
      cwd: input.workspacePath,
      model: input.model,
      effort: this.resolveClaudeEffort(input.thinkingMode),
      canUseTool: this.resolvePermissionHandler(input.runtimePermissionMode),
    };

    if (input.isResume) {
      options.resume = input.sessionId;
    } else {
      options.sessionId = input.sessionId;
    }

    const promptInput = await this.buildPromptInput(input.prompt, input.imagePaths, input.workspacePath);
    const queryInstance = query({
      prompt: promptInput as any,
      options,
    });

    return {
      stream: queryInstance,
      stop: async () => {
        await queryInstance.interrupt();
        return true;
      },
      setModel: async (model: string) => {
        await queryInstance.setModel(model);
      },
    };
  }

  /**
   * Builds a Claude prompt payload. When images are present, this returns an async iterable user message.
   */
  private async buildPromptInput(
    prompt: string,
    imagePaths?: string[],
    workspacePath?: string,
  ): Promise<string | AsyncIterable<ClaudeUserPromptMessage>> {
    if (!imagePaths || imagePaths.length === 0) {
      return prompt;
    }

    const content: ClaudeUserPromptMessage['message']['content'] = [
      { type: 'text', text: prompt },
    ];

    for (const imagePath of imagePaths) {
      const resolvedPath = path.isAbsolute(imagePath)
        ? imagePath
        : path.resolve(workspacePath ?? process.cwd(), imagePath);
      const extension = path.extname(resolvedPath).toLowerCase();
      const mediaType = SUPPORTED_CLAUDE_IMAGE_TYPES.get(extension);
      if (!mediaType) {
        continue;
      }

      const imageBytes = await readFile(resolvedPath);
      content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: mediaType,
          data: imageBytes.toString('base64'),
        },
      });
    }

    const sdkPrompt = (async function* (): AsyncIterable<ClaudeUserPromptMessage> {
      yield {
        type: 'user',
        message: {
          role: 'user',
          content,
        },
        parent_tool_use_id: null,
        timestamp: new Date().toISOString(),
      };
    })();

    return sdkPrompt;
  }

  /**
   * Produces compact event metadata for frontend stream rendering.
   */
  protected mapSdkEvent(rawEvent: unknown): ProviderSessionEvent | null {
    if (typeof rawEvent !== 'object' || rawEvent === null) {
      return {
        timestamp: new Date().toISOString(),
        channel: 'sdk',
        message: String(rawEvent),
      };
    }

    const messageType = this.getStringProperty(rawEvent, 'type');
    const messageSubtype = this.getStringProperty(rawEvent, 'subtype');
    const message = [messageType, messageSubtype].filter(Boolean).join(':') || 'claude_event';

    return {
      timestamp: new Date().toISOString(),
      channel: 'sdk',
      message,
      data: rawEvent,
    };
  }

  /**
   * Normalizes Claude model metadata to the shared model shape.
   */
  private mapModelInfo(model: ModelInfo): ProviderModel {
    return {
      value: model.value,
      displayName: model.displayName,
      description: model.description,
      supportsThinkingModes: Boolean(model.supportsEffort),
      supportedThinkingModes: model.supportedEffortLevels,
    };
  }

  /**
   * Maps requested thinking mode to Claude effort levels.
   */
  private resolveClaudeEffort(thinkingMode?: string): Options['effort'] {
    if (!thinkingMode) {
      return 'high';
    }

    const normalized = thinkingMode.trim().toLowerCase();
    if (CLAUDE_THINKING_LEVELS.has(normalized)) {
      return normalized as Options['effort'];
    }

    return 'high';
  }

  /**
   * Builds a runtime permission callback when explicit allow/deny is requested.
   */
  private resolvePermissionHandler(mode?: RuntimePermissionMode): CanUseTool | undefined {
    if (!mode || mode === 'ask') {
      return undefined;
    }

    if (mode === 'allow') {
      return async () => ({ behavior: 'allow' });
    }

    return async () => ({
      behavior: 'deny',
      message: 'Permission denied by runtime permission mode.',
      interrupt: false,
    });
  }

  /**
   * Reads one optional string property from an unknown event object.
   */
  private getStringProperty(value: unknown, key: string): string | undefined {
    if (!value || typeof value !== 'object') {
      return undefined;
    }

    const record = value as Record<string, unknown>;
    const rawValue = record[key];
    if (typeof rawValue !== 'string') {
      return undefined;
    }

    return rawValue;
  }
}
