import { CLAUDE_FALLBACK_MODELS, ClaudeProviderModels } from '@/modules/providers/list/claude/claude-models.provider.js';
import type { IProviderModels } from '@/shared/interfaces.js';
import type {
  ProviderChangeActiveModelInput,
  ProviderCurrentActiveModel,
  ProviderModelsDefinition,
  ProviderSessionActiveModelChange,
} from '@/shared/types.js';
import {
  buildDefaultProviderCurrentActiveModel,
  readProviderSessionActiveModelChange,
  writeProviderSessionActiveModelChange,
} from '@/shared/utils.js';

// Curated direct API choices: https://platform.minimax.io/docs/guides/models-intro.md
// Standard pricing: https://platform.minimax.io/docs/guides/pricing-paygo.md
export const MINIMAX_MODEL_IDS = ['MiniMax-M3.1-Flash', 'MiniMax-M3'] as const;

// Legacy IDs remain valid for saved requests and transcript identification.
export const MINIMAX_MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  'MiniMax-M3.1-Flash': 1_000_000,
  'MiniMax-M3': 1_000_000,
  'MiniMax-M2.7': 204_800,
};

export const MINIMAX_MODELS: ProviderModelsDefinition = {
  OPTIONS: [
    {
      value: MINIMAX_MODEL_IDS[0],
      label: MINIMAX_MODEL_IDS[0],
      description: '1,000,000-token context · $0.15 input / $0.60 output per million tokens',
      effort: {
        default: 'max',
        values: [
          { value: 'low' }, { value: 'medium' }, { value: 'high' },
          { value: 'xhigh' }, { value: 'max' },
        ],
      },
    },
    {
      value: MINIMAX_MODEL_IDS[1],
      label: MINIMAX_MODEL_IDS[1],
      description: '1,000,000-token context · Standard input/output per million tokens: $0.30/$1.20 up to 512k, $0.60/$2.40 above 512k',
    },
  ],
  DEFAULT: MINIMAX_MODEL_IDS[0],
};

export const isMiniMaxModel = (model: unknown): boolean => {
  if (typeof model !== 'string') {
    return false;
  }

  const normalized = model.trim();
  return Object.keys(MINIMAX_MODEL_CONTEXT_WINDOWS).some(
    (modelId) => normalized === modelId || normalized.startsWith(`${modelId}[`),
  );
};

export const resolveMiniMaxContextWindow = (model: string): number => {
  const normalized = model.trim();
  const modelId = Object.keys(MINIMAX_MODEL_CONTEXT_WINDOWS).find(
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

  async getCurrentActiveModel(sessionId?: string): Promise<ProviderCurrentActiveModel> {
    if (sessionId?.trim()) {
      const override = await readProviderSessionActiveModelChange('minimax', sessionId);
      if (override.changed && override.model) {
        return { model: override.model };
      }
      // MiniMax shares the compatible runtime's transcript format. Preserve the
      // recorded session model even if it is no longer an ordinary picker choice.
      const recorded = await new ClaudeProviderModels().getCurrentActiveModel(sessionId);
      if (recorded.model !== CLAUDE_FALLBACK_MODELS.DEFAULT) {
        return recorded;
      }
    }
    return buildDefaultProviderCurrentActiveModel(MINIMAX_MODELS);
  }

  async changeActiveModel(
    input: ProviderChangeActiveModelInput,
  ): Promise<ProviderSessionActiveModelChange> {
    return writeProviderSessionActiveModelChange('minimax', input);
  }
}
