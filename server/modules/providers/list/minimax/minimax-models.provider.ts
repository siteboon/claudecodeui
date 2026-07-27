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

export const MINIMAX_MODEL_IDS = ['MiniMax-M3', 'MiniMax-M2.7'] as const;

export const MINIMAX_MODEL_CONTEXT_WINDOWS: Record<(typeof MINIMAX_MODEL_IDS)[number], number> = {
  'MiniMax-M3': 1_000_000,
  'MiniMax-M2.7': 204_800,
};

export const MINIMAX_MODELS: ProviderModelsDefinition = {
  OPTIONS: [
    {
      value: MINIMAX_MODEL_IDS[0],
      label: MINIMAX_MODEL_IDS[0],
      description: '1,000,000-token context · $0.60 input / $2.40 output per million tokens',
    },
    {
      value: MINIMAX_MODEL_IDS[1],
      label: MINIMAX_MODEL_IDS[1],
      description: '204,800-token context · $0.30 input / $1.20 output per million tokens',
    },
  ],
  DEFAULT: MINIMAX_MODEL_IDS[0],
};

export const isMiniMaxModel = (model: unknown): boolean => {
  if (typeof model !== 'string') {
    return false;
  }

  const normalized = model.trim();
  return MINIMAX_MODEL_IDS.some(
    (modelId) => normalized === modelId || normalized.startsWith(`${modelId}[`),
  );
};

export const resolveMiniMaxContextWindow = (model: string): number => {
  const normalized = model.trim();
  const modelId = MINIMAX_MODEL_IDS.find(
    (candidate) => normalized === candidate || normalized.startsWith(`${candidate}[`),
  );
  return modelId
    ? MINIMAX_MODEL_CONTEXT_WINDOWS[modelId]
    : MINIMAX_MODEL_CONTEXT_WINDOWS[MINIMAX_MODELS.DEFAULT as keyof typeof MINIMAX_MODEL_CONTEXT_WINDOWS];
};

export class MiniMaxProviderModels implements IProviderModels {
  async getSupportedModels(): Promise<ProviderModelsDefinition> {
    return MINIMAX_MODELS;
  }

  async getCurrentActiveModel(): Promise<ProviderCurrentActiveModel> {
    return buildDefaultProviderCurrentActiveModel(MINIMAX_MODELS);
  }

  async changeActiveModel(
    input: ProviderChangeActiveModelInput,
  ): Promise<ProviderSessionActiveModelChange> {
    return writeProviderSessionActiveModelChange('minimax', input);
  }
}
