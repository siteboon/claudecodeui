import type { IProviderModels } from '@/shared/interfaces.js';
import type {
  ProviderCurrentActiveModel,
  ProviderModelsDefinition,
} from '@/shared/types.js';
import { buildDefaultProviderCurrentActiveModel } from '@/shared/utils.js';

/**
 * Curated pi catalog shipped as immutable CloudCLI defaults.
 *
 * pi routes by `<providerID>/<modelID>` exactly like OpenCode, but Phase 1 has
 * no `pi models`-style discovery to read a live registry from, so this list is
 * the curated intersection of the providers pi can address: Anthropic, the
 * Z.ai Coding CN gateway, and OpenAI. Every entry declares an empty effort list
 * until pi exposes per-model reasoning levels through its CLI.
 *
 * The default mirrors the frontend fallback in `useChatProviderState` so both
 * layers agree on what a fresh pi session runs with.
 */
export const PI_PREDEFINED_MODELS: ProviderModelsDefinition = {
  OPTIONS: [
    { value: 'anthropic/claude-sonnet-4-5', label: 'Claude Sonnet 4.5', description: 'Anthropic', effort: { values: [] } },
    { value: 'anthropic/claude-sonnet-4', label: 'Claude Sonnet 4', description: 'Anthropic', effort: { values: [] } },
    { value: 'anthropic/claude-haiku-4-5', label: 'Claude Haiku 4.5', description: 'Anthropic', effort: { values: [] } },
    { value: 'anthropic/claude-haiku-3-5', label: 'Claude Haiku 3.5', description: 'Anthropic', effort: { values: [] } },
    { value: 'anthropic/claude-opus-4-5', label: 'Claude Opus 4.5', description: 'Anthropic', effort: { values: [] } },
    { value: 'anthropic/claude-opus-4-1', label: 'Claude Opus 4.1', description: 'Anthropic', effort: { values: [] } },
    { value: 'zai-coding-cn/glm-5.3', label: 'GLM 5.3', description: 'Z.ai Coding CN', effort: { values: [] } },
    { value: 'zai-coding-cn/glm-5.3-flash', label: 'GLM 5.3 Flash', description: 'Z.ai Coding CN', effort: { values: [] } },
    { value: 'zai-coding-cn/glm-5.2', label: 'GLM 5.2', description: 'Z.ai Coding CN', effort: { values: [] } },
    { value: 'openai/gpt-5.6', label: 'GPT-5.6', description: 'OpenAI', effort: { values: [] } },
    { value: 'openai/gpt-5.4', label: 'GPT-5.4', description: 'OpenAI', effort: { values: [] } },
    { value: 'openai/gpt-5.4-mini', label: 'GPT-5.4 mini', description: 'OpenAI', effort: { values: [] } },
  ],
  DEFAULT: 'anthropic/claude-sonnet-4',
};

/** Provider registry model adapter for pi predefined models. */
export class PiProviderModels implements IProviderModels {
  async getSupportedModels(): Promise<ProviderModelsDefinition> {
    return PI_PREDEFINED_MODELS;
  }

  async getCurrentActiveModel(_sessionId?: string): Promise<ProviderCurrentActiveModel> {
    // Phase 1: pi's per-session model lives in the JSONL transcript, which the
    // sessions facet already surfaces; the registry keeps answering with the
    // curated default instead of reading runtime state.
    return buildDefaultProviderCurrentActiveModel(PI_PREDEFINED_MODELS);
  }
}
