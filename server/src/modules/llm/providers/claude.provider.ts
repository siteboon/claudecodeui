import {
  query,
  type CanUseTool,
  type ModelInfo,
  type Options,
} from '@anthropic-ai/claude-agent-sdk';

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

    const queryInstance = query({
      prompt: input.prompt,
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
