import type { IProviderModels } from '@/shared/interfaces.js';
import type {
  ProviderCurrentActiveModel,
  ProviderModelsDefinition,
} from '@/shared/types.js';
import { buildDefaultProviderCurrentActiveModel } from '@/shared/utils.js';

/**
 * Curated Pi catalog shipped as immutable CloudCLI defaults.
 *
 * Pi resolves models through its own `models.json` provider/model pairs, so the
 * skeleton ships an empty catalog: whatever the user's Pi installation can
 * reach stays the source of truth until the catalog adapter lands. The default
 * mirrors the frontend fallback in `useChatProviderState` so both layers agree
 * while the catalog is still empty.
 */
export const PI_PREDEFINED_MODELS: ProviderModelsDefinition = {
  OPTIONS: [],
  DEFAULT: 'anthropic/claude-sonnet-4',
};

export class PiProviderModels implements IProviderModels {
  async getSupportedModels(): Promise<ProviderModelsDefinition> {
    return PI_PREDEFINED_MODELS;
  }

  async getCurrentActiveModel(): Promise<ProviderCurrentActiveModel> {
    return buildDefaultProviderCurrentActiveModel(PI_PREDEFINED_MODELS);
  }
}
