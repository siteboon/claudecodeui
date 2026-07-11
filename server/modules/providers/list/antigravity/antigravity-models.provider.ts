import crossSpawn from 'cross-spawn';

import type { IProviderModels } from '@/shared/interfaces.js';
import type {
  ProviderChangeActiveModelInput,
  ProviderCurrentActiveModel,
  ProviderModelsDefinition,
  ProviderSessionActiveModelChange,
} from '@/shared/types.js';
import {
  buildDefaultProviderCurrentActiveModel,
  writeProviderSessionActiveModelChange,
} from '@/shared/utils.js';

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

const spawnFunction = crossSpawn;

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

export class AntigravityProviderModels implements IProviderModels {
  async getSupportedModels(): Promise<ProviderModelsDefinition> {
    const result = spawnFunction.sync('agy', ['models'], {
      encoding: 'utf8',
      timeout: MODELS_TIMEOUT_MS,
    });

    if (result.error || result.status !== 0) {
      return ANTIGRAVITY_FALLBACK_MODELS;
    }

    return parseAntigravityModelsStdout(result.stdout || '');
  }

  async getCurrentActiveModel(): Promise<ProviderCurrentActiveModel> {
    return buildDefaultProviderCurrentActiveModel(await this.getSupportedModels());
  }

  async changeActiveModel(
    input: ProviderChangeActiveModelInput,
  ): Promise<ProviderSessionActiveModelChange> {
    return writeProviderSessionActiveModelChange('antigravity', input, { supported: true });
  }
}
