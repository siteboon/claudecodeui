import { readFile } from 'node:fs/promises';
import os from 'node:os';

import { query } from '@anthropic-ai/claude-agent-sdk';
import type { ModelInfo } from '@anthropic-ai/claude-agent-sdk';

import { sessionsDb } from '@/modules/database/index.js';
import { resolveClaudeCodeExecutablePath } from '@/shared/claude-cli-path.js';
import type { IProviderModels } from '@/shared/interfaces.js';
import type {
  ProviderCurrentActiveModel,
  ProviderModelOption,
  ProviderModelsDefinition,
} from '@/shared/types.js';
import {
  buildDefaultProviderCurrentActiveModel,
  isPlaceholderProviderModel,
  stripAnsiSequences,
} from '@/shared/utils.js';

/**
 * Ultracode is not one of the SDK's reasoning-effort levels. Selecting it runs the turn at
 * `xhigh` effort with standing dynamic-workflow orchestration, which the Claude runtime
 * translates into the session-scoped `ultracode` setting. It is therefore only offered on
 * models this catalog already marks as xhigh-capable.
 */
export const CLAUDE_ULTRACODE_EFFORT = 'ultracode';

const ULTRACODE_EFFORT_OPTION = {
  value: CLAUDE_ULTRACODE_EFFORT,
  description: 'Highest effort plus standing workflow orchestration.',
};

export const CLAUDE_PREDEFINED_MODELS: ProviderModelsDefinition = {
  OPTIONS: [
    {
      value: 'default',
      label: 'Default (recommended)',
      description: 'Use the recommended model for your Claude account and deployment.',
      effort: {
        default: 'high',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
          { value: 'max' },
        ],
      },
    },
    {
      value: 'best',
      label: 'Best available',
      description: 'Use Fable 5 when available, otherwise the latest Opus model.',
      effort: {
        default: 'high',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
          { value: 'xhigh' },
          { value: 'max' },
          ULTRACODE_EFFORT_OPTION,
        ],
      },
    },
    {
      value: 'fable',
      label: 'Fable 5',
      description: 'Most capable Claude model for the hardest, longest-running tasks.',
      effort: {
        default: 'high',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
          { value: 'xhigh' },
          { value: 'max' },
          ULTRACODE_EFFORT_OPTION,
        ],
      },
    },
    {
      value: 'sonnet',
      label: 'Sonnet',
      description: 'Latest Sonnet model for everyday coding tasks.',
      effort: {
        default: 'high',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
          { value: 'xhigh' },
          { value: 'max' },
          ULTRACODE_EFFORT_OPTION,
        ],
      },
    },
    {
      value: 'sonnet[1m]',
      label: 'Sonnet (1M context)',
      description: 'Latest Sonnet model with a 1M context window.',
      effort: {
        default: 'high',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
          { value: 'xhigh' },
          { value: 'max' },
          ULTRACODE_EFFORT_OPTION,
        ],
      },
    },
    {
      value: 'opus',
      label: 'Opus',
      description: 'Latest Opus model for complex reasoning and coding tasks.',
      effort: {
        default: 'high',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
          { value: 'xhigh' },
          { value: 'max' },
          ULTRACODE_EFFORT_OPTION,
        ],
      },
    },
    {
      value: 'opus[1m]',
      label: 'Opus (1M context)',
      description: 'Latest Opus model with a 1M context window.',
      effort: {
        default: 'high',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
          { value: 'xhigh' },
          { value: 'max' },
          ULTRACODE_EFFORT_OPTION,
        ],
      },
    },
    {
      value: 'haiku',
      label: 'Haiku',
      description: 'Fast and efficient Claude model for simple tasks.',
    },
    {
      value: 'opusplan',
      label: 'Opus Plan',
      description: 'Use Opus while planning, then switch to Sonnet for execution.',
      effort: {
        default: 'high',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
          { value: 'xhigh' },
          { value: 'max' },
          ULTRACODE_EFFORT_OPTION,
        ],
      },
    },
  ],
  DEFAULT: 'default',
};

export const findClaudeModelOption = (model: string | undefined | null): ProviderModelOption | null => {
  const normalizedModel = typeof model === 'string' ? model.trim() : '';
  if (!normalizedModel) {
    return null;
  }

  return CLAUDE_PREDEFINED_MODELS.OPTIONS.find((option) => option.value === normalizedModel) ?? null;
};
type ClaudeInitEvent = {
  sessionId?: string;
  session_id?: string;
  type?: string;
  subtype?: string;
  model?: string;
  message?: {
    content?: unknown;
    model?: string;
  };
};

/** Exported for tests. */
export const extractClaudeEventModel = (event: ClaudeInitEvent, sessionId: string): string | null => {
  const eventSessionId = event.sessionId ?? event.session_id;
  if (eventSessionId && eventSessionId !== sessionId) {
    return null;
  }

  const contentModel = extractClaudeModelFromMessageContent(event.message?.content);
  if (contentModel) {
    return contentModel;
  }

  const directModel = event.model?.trim();
  if (directModel && !isPlaceholderProviderModel(directModel)) {
    return directModel;
  }

  const messageModel = event.message?.model?.trim();
  return messageModel && !isPlaceholderProviderModel(messageModel) ? messageModel : null;
};

const extractTaggedContent = (content: string, tagName: string): string | null => {
  const escapedTagName = tagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`<${escapedTagName}>([\\s\\S]*?)<\\/${escapedTagName}>`).exec(content);
  return match ? match[1] : null;
};

const extractClaudeModelFromTextContent = (content: string): string | null => {
  const localCommandStdout = extractTaggedContent(content, 'local-command-stdout');
  if (localCommandStdout !== null) {
    const cleanedStdout = stripAnsiSequences(localCommandStdout).replace(/\s+/g, ' ').trim();
    const changedModel = /(?:set|changed|switched)\s+model\s+to\s+(.+?)\.?$/i.exec(cleanedStdout);
    const stdoutModel = changedModel?.[1]?.trim();
    // A placeholder stdout hit must not shadow a real <model> tag further down.
    if (stdoutModel && !isPlaceholderProviderModel(stdoutModel)) {
      return stdoutModel;
    }
  }

  const modelTag = extractTaggedContent(content, 'model')?.trim();
  return modelTag && !isPlaceholderProviderModel(modelTag) ? modelTag : null;
};

const extractClaudeModelFromMessageContent = (content: unknown): string | null => {
  if (typeof content === 'string') {
    return extractClaudeModelFromTextContent(content);
  }

  if (!Array.isArray(content)) {
    return null;
  }

  for (const part of content) {
    if (!part || typeof part !== 'object' || !('text' in part) || typeof part.text !== 'string') {
      continue;
    }

    // extractClaudeModelFromTextContent rejects placeholders, so a placeholder
    // part yields null here and a later part can still supply the real model.
    const model = extractClaudeModelFromTextContent(part.text);
    if (model) {
      return model;
    }
  }

  return null;
};

const readClaudeSessionModelFromJsonl = async (
  sessionId: string,
  jsonlPath: string,
): Promise<ProviderCurrentActiveModel | null> => {
  const content = await readFile(jsonlPath, 'utf8');
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const event = JSON.parse(lines[index]) as ClaudeInitEvent;
      const model = extractClaudeEventModel(event, sessionId);
      if (model) {
        return { model };
      }
    } catch {
      // Skip malformed JSONL lines that can happen during concurrent writes.
    }
  }

  return null;
};

// The CLI's list changes only when Claude Code updates or the login changes.
const SUPPORTED_MODELS_CACHE_MS = 10 * 60 * 1000;

/**
 * The CLI's own model list (what its /model picker shows) mapped onto the
 * catalog shape. Ultracode is kept for models the fixed catalog offers it on.
 */
export const buildClaudeModelsDefinition = (models: ModelInfo[]): ProviderModelsDefinition => {
  const options: ProviderModelOption[] = models
    .filter((model) => typeof model.value === 'string' && model.value)
    .map((model) => {
      const levels = model.supportsEffort ? model.supportedEffortLevels ?? [] : [];
      const values: Array<{ value: string; description?: string }> = levels.map((level) => ({ value: level }));
      const known = findClaudeModelOption(model.value);
      if (levels.includes('xhigh') && known?.effort?.values.some((option) => option.value === CLAUDE_ULTRACODE_EFFORT)) {
        values.push(ULTRACODE_EFFORT_OPTION);
      }
      return {
        value: model.value,
        label: model.displayName || model.value,
        description: model.description,
        ...(values.length > 0
          ? { effort: { default: levels.includes('high') ? 'high' : levels[0], values } }
          : {}),
      };
    });
  return {
    OPTIONS: options,
    DEFAULT: options.some((option) => option.value === CLAUDE_PREDEFINED_MODELS.DEFAULT)
      ? CLAUDE_PREDEFINED_MODELS.DEFAULT
      : options[0]?.value ?? CLAUDE_PREDEFINED_MODELS.DEFAULT,
  };
};

type ModelsQuery = AsyncIterable<unknown> & { supportedModels?: () => Promise<ModelInfo[]> };

type ClaudeProviderModelsDependencies = {
  createQuery: (params: { prompt: AsyncIterable<never>; options: Record<string, unknown> }) => ModelsQuery;
  now: () => number;
};

export class ClaudeProviderModels implements IProviderModels {
  private cached: { models: ProviderModelsDefinition; at: number } | null = null;
  private inFlight: Promise<ProviderModelsDefinition> | null = null;

  constructor(private readonly dependencies: ClaudeProviderModelsDependencies = {
    createQuery: (params) => query(params as never) as unknown as ModelsQuery,
    now: () => Date.now(),
  }) {}

  /**
   * Asks the CLI for its model list from a process that is sent no prompt and
   * saves no session (the reason this was once disabled: a prompted query left
   * a session file behind). Falls back to the fixed catalog when it cannot.
   */
  async getSupportedModels(): Promise<ProviderModelsDefinition> {
    if (this.cached && this.dependencies.now() - this.cached.at < SUPPORTED_MODELS_CACHE_MS) {
      return this.cached.models;
    }
    if (!this.inFlight) {
      this.inFlight = this.readSupportedModels()
        .then((models) => {
          this.cached = { models, at: this.dependencies.now() };
          return models;
        })
        .catch((error) => {
          console.warn('[Claude] Using the built-in model list:', error instanceof Error ? error.message : error);
          return CLAUDE_PREDEFINED_MODELS;
        })
        .finally(() => { this.inFlight = null; });
    }
    return this.inFlight;
  }

  private async readSupportedModels(): Promise<ProviderModelsDefinition> {
    let release = () => {};
    const held = new Promise<void>((resolve) => { release = resolve; });
    const prompt: AsyncIterable<never> = {
      [Symbol.asyncIterator]: () => ({
        next: async () => {
          await held;
          return { done: true, value: undefined as never };
        },
      }),
    };
    const options: Record<string, unknown> = { cwd: os.homedir(), persistSession: false };
    const executable = resolveClaudeCodeExecutablePath(process.env.CLAUDE_CLI_PATH);
    if (executable) {
      options.pathToClaudeCodeExecutable = executable;
    }

    const instance = this.dependencies.createQuery({ prompt, options });
    try {
      if (typeof instance.supportedModels !== 'function') {
        throw new Error('the installed Claude SDK cannot list models');
      }
      const definition = buildClaudeModelsDefinition(await instance.supportedModels());
      if (definition.OPTIONS.length === 0) {
        throw new Error('the CLI listed no models');
      }
      return definition;
    } finally {
      release();
      // Drain so the process winds down instead of lingering.
      void (async () => {
        try {
          for await (const _message of instance) { /* discard */ }
        } catch {
          // A process that exits on closed stdin may end its stream with an error.
        }
      })();
    }
  }

  async getCurrentActiveModel(sessionId?: string): Promise<ProviderCurrentActiveModel> {
    if (!sessionId?.trim()) {
      return buildDefaultProviderCurrentActiveModel(await this.getSupportedModels());
    }

    try {
      const jsonlPath = sessionsDb.getSessionById(sessionId)?.jsonl_path;
      const activeModel = jsonlPath
        ? await readClaudeSessionModelFromJsonl(sessionId, jsonlPath)
        : null;
      if (activeModel?.model) {
        return activeModel;
      }
    } catch {
      // Fall through to the provider default when the session-backed lookup fails.
    }

    return buildDefaultProviderCurrentActiveModel(await this.getSupportedModels());
  }
}
