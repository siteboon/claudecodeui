import type { IProviderModels } from '@/shared/interfaces.js';
import type {
  ProviderCurrentActiveModel,
  ProviderModelsDefinition,
} from '@/shared/types.js';
import {
  buildDefaultProviderCurrentActiveModel,
  runProviderCliCommand,
} from '@/shared/utils.js';

/** Fallback model catalog returned when the Antigravity CLI cannot be queried. */
export const ANTIGRAVITY_FALLBACK_MODELS: ProviderModelsDefinition = {
  OPTIONS: [
    {
      value: 'Gemini 3.5 Flash (Medium)',
      label: 'Gemini 3.5 Flash (Medium)',
      description: 'Antigravity CLI model',
    },
    {
      value: 'Gemini 3.5 Flash (High)',
      label: 'Gemini 3.5 Flash (High)',
      description: 'Antigravity CLI model',
    },
    {
      value: 'Gemini 3.5 Flash (Low)',
      label: 'Gemini 3.5 Flash (Low)',
      description: 'Antigravity CLI model',
    },
    {
      value: 'Gemini 3.1 Pro (High)',
      label: 'Gemini 3.1 Pro (High)',
      description: 'Antigravity CLI model',
    },
    {
      value: 'Gemini 3.1 Pro (Low)',
      label: 'Gemini 3.1 Pro (Low)',
      description: 'Antigravity CLI model',
    },
    {
      value: 'Claude Sonnet 4.6 (Thinking)',
      label: 'Claude Sonnet 4.6 (Thinking)',
      description: 'Antigravity CLI model',
    },
    {
      value: 'Claude Opus 4.6 (Thinking)',
      label: 'Claude Opus 4.6 (Thinking)',
      description: 'Antigravity CLI model',
    },
    {
      value: 'GPT-OSS 120B (Medium)',
      label: 'GPT-OSS 120B (Medium)',
      description: 'Antigravity CLI model',
    },
  ],
  DEFAULT: 'Gemini 3.5 Flash (Medium)',
};

const MODELS_TIMEOUT_MS = 20_000;

/** Parses the line-oriented model list returned by `agy models`. */
export const parseAntigravityModelsStdout = (stdout: string): ProviderModelsDefinition => {
  const models = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => ({
      value: line,
      label: line,
      description: 'Antigravity CLI model',
    }));

  if (models.length === 0) {
    return ANTIGRAVITY_FALLBACK_MODELS;
  }

  return {
    OPTIONS: models,
    DEFAULT: models[0].value,
  };
};

/** Antigravity model discovery adapter used by provider model services. */
export class AntigravityProviderModels implements IProviderModels {
  /** Queries `agy models`, falling back to a stable catalog on probe failures. */
  async getSupportedModels(): Promise<ProviderModelsDefinition> {
    const result = await runProviderCliCommand('agy', ['models'], {
      timeoutMs: MODELS_TIMEOUT_MS,
    });

    if (result.error || result.exitCode !== 0) {
      return ANTIGRAVITY_FALLBACK_MODELS;
    }

    return parseAntigravityModelsStdout(result.stdout || '');
  }

  /** Resolves the default active model from the current AGY catalog. */
  async getCurrentActiveModel(): Promise<ProviderCurrentActiveModel> {
    return buildDefaultProviderCurrentActiveModel(await this.getSupportedModels());
  }
}
