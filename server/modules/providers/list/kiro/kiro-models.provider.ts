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

/**
 * Kiro (AWS) model catalog.
 *
 * Verified against `kiro-cli chat --list-models -f json` (Kiro CLI 2.3.0). The
 * full catalog can be fetched dynamically, but the static list below is a
 * conservative Claude-only subset suitable for v1. The `auto` router default
 * lets Kiro pick the best available model for the request.
 */
export const KIRO_FALLBACK_MODELS: ProviderModelsDefinition = {
  OPTIONS: [
    { value: 'auto', label: 'Auto (router)' },
    { value: 'claude-opus-4.7', label: 'Claude Opus 4.7' },
    { value: 'claude-opus-4.6', label: 'Claude Opus 4.6' },
    { value: 'claude-sonnet-4.6', label: 'Claude Sonnet 4.6' },
    { value: 'claude-sonnet-4.5', label: 'Claude Sonnet 4.5' },
    { value: 'claude-haiku-4.5', label: 'Claude Haiku 4.5' },
  ],
  DEFAULT: 'auto',
};

export class KiroProviderModels implements IProviderModels {
  async getSupportedModels(): Promise<ProviderModelsDefinition> {
    return KIRO_FALLBACK_MODELS;
  }

  async getCurrentActiveModel(): Promise<ProviderCurrentActiveModel> {
    // Kiro resolves the effective model at spawn time via the `--model` CLI
    // flag (ACP ignores model on `session/prompt`). There is no persisted
    // per-session model on disk to read back, so fall back to the catalog
    // default.
    return buildDefaultProviderCurrentActiveModel(await this.getSupportedModels());
  }

  async changeActiveModel(
    input: ProviderChangeActiveModelInput,
  ): Promise<ProviderSessionActiveModelChange> {
    return writeProviderSessionActiveModelChange('kiro', input);
  }
}
