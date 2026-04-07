import {
  query,
  type CanUseTool,
  type ModelInfo,
  type Options,
} from '@anthropic-ai/claude-agent-sdk';
import path from 'node:path';
import { readFile } from 'node:fs/promises';

import { BaseSdkProvider } from '@/modules/ai-runtime/providers/base/base-sdk.provider.js';
import type {
  IProviderMcpRuntime,
  IProviderSessionSynchronizerRuntime,
  IProviderSkillsRuntime,
  ProviderModel,
  ProviderSessionEvent,
  RuntimePermissionMode,
  StartSessionInput,
} from '@/modules/ai-runtime/types/index.js';
import { ClaudeMcpRuntime } from '@/modules/ai-runtime/providers/claude/claude-mcp.runtime.js';
import { ClaudeSkillsRuntime } from '@/modules/ai-runtime/providers/claude/claude-skills.runtime.js';
import { ClaudeSessionSynchronizerRuntime } from '@/modules/ai-runtime/providers/claude/claude-session-synchronizer.runtime.js';

type ClaudeExecutionInput = StartSessionInput & {
  sessionId: string;
  isResume: boolean;
  emitEvent?: (event: ProviderSessionEvent) => void;
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
 * Safely reads one optional string value from unknown data.
 */
const readString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length ? normalized : undefined;
};

/**
 * Claude SDK provider implementation.
 */
export class ClaudeProvider extends BaseSdkProvider {
  readonly mcp: IProviderMcpRuntime = new ClaudeMcpRuntime();
  readonly skills: IProviderSkillsRuntime = new ClaudeSkillsRuntime();
  readonly sessionSynchronizer: IProviderSessionSynchronizerRuntime = new ClaudeSessionSynchronizerRuntime();

  constructor() {
    super('claude', {
      supportsRuntimePermissionRequests: true,
      supportsThinkingModeControl: true,
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
  }> {
    const options: Options = {
      cwd: input.workspacePath,
      model: input.model,
      effort: this.resolveClaudeEffort(input.thinkingMode),
      canUseTool: this.resolvePermissionHandler(input.runtimePermissionMode, input.emitEvent),
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
  private resolvePermissionHandler(
    mode?: RuntimePermissionMode,
    emitEvent?: (event: ProviderSessionEvent) => void,
  ): CanUseTool | undefined {
    if (!mode || mode === 'ask') {
      return undefined;
    }

    if (mode === 'allow') {
      return async (toolName, input, options) => {
        const optionsRecord = options as Record<string, unknown>;
        emitEvent?.({
          timestamp: new Date().toISOString(),
          channel: 'system',
          message: `Tool permission requested for "${toolName}".`,
          data: {
            type: 'tool_use_request',
            toolName,
            input,
            toolUseID: options.toolUseID,
            title: readString(optionsRecord.title),
            displayName: readString(optionsRecord.displayName),
            description: readString(optionsRecord.description),
            blockedPath: options.blockedPath,
          },
        });
        return { behavior: 'allow' };
      };
    }

    return async (toolName, input, options) => {
      const optionsRecord = options as Record<string, unknown>;
      emitEvent?.({
        timestamp: new Date().toISOString(),
        channel: 'system',
        message: `Tool permission denied for "${toolName}".`,
        data: {
          type: 'tool_use_request',
          toolName,
          input,
          toolUseID: options.toolUseID,
          title: readString(optionsRecord.title),
          displayName: readString(optionsRecord.displayName),
          description: readString(optionsRecord.description),
          blockedPath: options.blockedPath,
        },
      });
      return {
        behavior: 'deny',
        message: 'Permission denied by runtime permission mode.',
        interrupt: false,
      };
    };
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
