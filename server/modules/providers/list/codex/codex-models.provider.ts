import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { IProviderModels } from '@/shared/interfaces.js';
import type { ProviderModelOption, ProviderModelsDefinition } from '@/shared/types.js';
import { readObjectRecord, readOptionalString } from '@/shared/utils.js';

export const CODEX_FALLBACK_MODELS: ProviderModelsDefinition = {
  OPTIONS: [
    { value: 'gpt-5.5', label: 'gpt-5.5' },
    { value: 'gpt-5.4', label: 'gpt-5.4' },
    { value: 'gpt-5.4-mini', label: 'gpt-5.4-mini' },
    { value: 'gpt-5.3-codex', label: 'gpt-5.3-codex' },
    { value: 'gpt-5.2', label: 'gpt-5.2' },
  ],
  DEFAULT: 'gpt-5.4',
};

type CodexCachedModel = {
  slug?: string;
  display_name?: string;
  description?: string;
  priority?: number;
  visibility?: string;
  supported_in_api?: boolean;
};

const CODEX_MODELS_CACHE_PATH = path.join(os.homedir(), '.codex', 'models_cache.json');

const isCodexCachedModel = (value: unknown): value is CodexCachedModel => {
  const record = readObjectRecord(value);
  return Boolean(record && readOptionalString(record.slug));
};

const readCodexPriority = (value: unknown): number => (
  typeof value === 'number' && Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER
);

const mapCodexModel = (model: CodexCachedModel): ProviderModelOption => ({
  value: model.slug as string,
  label: readOptionalString(model.display_name) ?? (model.slug as string),
  description: readOptionalString(model.description),
});

const buildCodexModelsDefinition = (models: CodexCachedModel[]): ProviderModelsDefinition => {
  const sortedModels = [...models]
    .filter((model) => model.visibility !== 'hidden' && model.supported_in_api !== false)
    .sort((left, right) => readCodexPriority(left.priority) - readCodexPriority(right.priority));

  const options: ProviderModelOption[] = [];
  const seenValues = new Set<string>();

  for (const model of sortedModels) {
    const mappedModel = mapCodexModel(model);
    if (seenValues.has(mappedModel.value)) {
      continue;
    }

    seenValues.add(mappedModel.value);
    options.push(mappedModel);
  }

  if (options.length === 0) {
    return CODEX_FALLBACK_MODELS;
  }

  return {
    OPTIONS: options,
    DEFAULT: options[0]?.value ?? CODEX_FALLBACK_MODELS.DEFAULT,
  };
};

export class CodexProviderModels implements IProviderModels {
  async getSupportedModels(): Promise<ProviderModelsDefinition> {
    try {
      const raw = await readFile(CODEX_MODELS_CACHE_PATH, 'utf8');
      const parsed = readObjectRecord(JSON.parse(raw));
      const models = Array.isArray(parsed?.models)
        ? parsed.models.filter(isCodexCachedModel)
        : [];

      return buildCodexModelsDefinition(models);
    } catch {
      return CODEX_FALLBACK_MODELS;
    }
  }
}
