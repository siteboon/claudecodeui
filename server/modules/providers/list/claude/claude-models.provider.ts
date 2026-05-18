import { query, type ModelInfo, type Options } from '@anthropic-ai/claude-agent-sdk';

import { resolveClaudeCodeExecutablePath } from '@/shared/claude-cli-path.js';
import type { IProviderModels } from '@/shared/interfaces.js';
import type { ProviderModelOption, ProviderModelsDefinition } from '@/shared/types.js';

export const CLAUDE_FALLBACK_MODELS: ProviderModelsDefinition = {
  OPTIONS: [
    { value: 'default', label: 'Default (recommended)' },
    { value: 'sonnet[1m]', label: 'Sonnet (1M context)' },
    { value: 'opus', label: 'Opus' },
    { value: 'opus[1m]', label: 'Opus (1M context)' },
    { value: 'haiku', label: 'Haiku' },
    { value: 'sonnet', label: 'sonnet' },
  ],
  DEFAULT: 'default',
};

type ClaudeModelQueryOptions = Pick<Options, 'env' | 'pathToClaudeCodeExecutable' | 'permissionMode'>;

const buildClaudeQueryOptions = (): ClaudeModelQueryOptions => ({
  env: { ...process.env },
  pathToClaudeCodeExecutable: resolveClaudeCodeExecutablePath(process.env.CLAUDE_CLI_PATH),
  permissionMode: 'default',
});

const mapClaudeModel = (model: ModelInfo): ProviderModelOption => ({
  value: model.value,
  label: model.displayName || model.value,
  description: model.description || undefined,
});

const buildClaudeModelsDefinition = (models: ModelInfo[]): ProviderModelsDefinition => {
  const options: ProviderModelOption[] = [];
  const seenValues = new Set<string>();

  for (const model of models) {
    const mappedModel = mapClaudeModel(model);
    if (seenValues.has(mappedModel.value)) {
      continue;
    }

    seenValues.add(mappedModel.value);
    options.push(mappedModel);
  }

  if (options.length === 0) {
    return CLAUDE_FALLBACK_MODELS;
  }

  const defaultValue = options.find((option) => option.value === 'default')?.value
    ?? options[0]?.value
    ?? CLAUDE_FALLBACK_MODELS.DEFAULT;

  return {
    OPTIONS: options,
    DEFAULT: defaultValue,
  };
};

export class ClaudeProviderModels implements IProviderModels {
  async getSupportedModels(): Promise<ProviderModelsDefinition> {
    let queryInstance: ReturnType<typeof query> | null = null;

    try {
      // The SDK exposes its runtime model catalog on the initialized query
      // instance, so we create a lightweight query and immediately close it
      // after reading the control-plane metadata.
      queryInstance = query({
        prompt: '',
        options: buildClaudeQueryOptions(),
      });

      const supportedModels = await queryInstance.supportedModels();

      return buildClaudeModelsDefinition(supportedModels);
    } catch {
      return CLAUDE_FALLBACK_MODELS;
    } finally {
      queryInstance?.close();
    }
  }
}
