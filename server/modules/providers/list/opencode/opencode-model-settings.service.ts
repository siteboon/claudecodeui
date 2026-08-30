import { AppError } from '@/shared/utils.js';
import { OpenCodeProviderModels } from '@/modules/providers/list/opencode/opencode-models.provider.js';
import {
  readModelCapabilities,
  type ModelCapabilities,
} from '@/modules/providers/list/opencode/opencode-model-capabilities.js';
import {
  getOverridesPath,
  readModelOverrides,
  writeModelOverride,
  type ModelOverride,
  type ModelOverrides,
} from '@/modules/providers/list/opencode/opencode-model-overrides.js';

/**
 * The settings page for OpenCode models: what the catalog offers, what each
 * model accepts, and what CloudCLI currently overrides.
 *
 * Kept apart from the routes so the validation has a place to live - the values
 * end up in a config file another program reads, so a nonsensical number has to
 * be refused here rather than break an OpenCode run later.
 */

export type ModelSettings = {
  /** File the overrides are written to. */
  overridesPath: string;
  /**
   * False when the user set `OPENCODE_CONFIG` themselves - then the overlay is
   * not applied, because that variable names a single file and overwriting it
   * would drop their config.
   */
  applied: boolean;
  /** The catalog entries this page lets you configure. */
  models: { value: string; label: string; description?: string }[];
  overrides: ModelOverrides;
  capabilities: Record<string, ModelCapabilities>;
};

/** Bounds that hold across providers; the per-model ceiling comes on top. */
const TEMPERATURE_RANGE = { min: 0, max: 2 };
const TOP_P_RANGE = { min: 0, max: 1 };
const MAX_OUTPUT_RANGE = { min: 1, max: 1_000_000 };

/** Input errors have to reach the page as 400 with their text, not as a bare 500. */
function invalid(message: string): AppError {
  return new AppError(message, { code: 'INVALID_MODEL_SETTINGS', statusCode: 400 });
}
function parseOptionalNumber(
  value: unknown,
  name: string,
  range: { min: number; max: number },
): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    throw invalid(`${name} must be a number`);
  }
  if (parsed < range.min || parsed > range.max) {
    throw invalid(`${name} must be between ${range.min} and ${range.max}`);
  }

  return parsed;
}

export const openCodeModelSettingsService = {
  async getSettings(): Promise<ModelSettings> {
    const models = await new OpenCodeProviderModels().getSupportedModels();
    const options = models.OPTIONS ?? [];
    const values = options.map((option) => option.value);

    return {
      overridesPath: getOverridesPath(),
      applied: !(process.env.OPENCODE_CONFIG || '').trim(),
      models: options.map((option) => ({
        value: option.value,
        label: option.label,
        description: option.description,
      })),
      overrides: await readModelOverrides(),
      capabilities: await readModelCapabilities(values),
    };
  },

  /**
   * Stores the settings for one model. Missing fields clear the stored value,
   * so an emptied input hands the model back to its own defaults.
   */
  async updateModel(payload: unknown): Promise<ModelSettings> {
    const body = (payload ?? {}) as Record<string, unknown>;
    const model = typeof body.model === 'string' ? body.model.trim() : '';
    if (!model || !model.includes('/')) {
      throw invalid('model must be a routed id like "ollama/qwen3.8:27b"');
    }

    const override: ModelOverride = {
      temperature: parseOptionalNumber(body.temperature, 'temperature', TEMPERATURE_RANGE),
      topP: parseOptionalNumber(body.topP, 'topP', TOP_P_RANGE),
      maxOutput: parseOptionalNumber(body.maxOutput, 'maxOutput', MAX_OUTPUT_RANGE),
    };

    const capabilities = await readModelCapabilities([model]);
    const known = capabilities[model];
    if (known && override.temperature !== undefined && !known.temperature) {
      throw invalid(`${model} does not accept a temperature`);
    }
    if (known?.maxOutput && override.maxOutput !== undefined && override.maxOutput > known.maxOutput) {
      throw invalid(`${model} answers with at most ${known.maxOutput} tokens`);
    }

    await writeModelOverride(model, override);
    return this.getSettings();
  },
};
