import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/**
 * Per-model sampling settings CloudCLI keeps for OpenCode.
 *
 * They live in a file of CloudCLI's own, never in the user's
 * `opencode.json[c]`: that file is hand-written, carries comments, and a
 * `JSON.stringify` round trip would flatten both. Instead the file is handed to
 * OpenCode through `OPENCODE_CONFIG`, which it merges into the global config
 * rather than replacing it.
 *
 * Measured, both against a stub provider that logs what it receives:
 *
 *   - `models.<id>.options` reaches the request verbatim: `temperature: 0.17`
 *     and `top_p: 0.42` in the config arrived as `"temperature":0.17,
 *     "top_p":0.42`, and `limit.output: 333` as `"max_tokens":333`.
 *   - The merge is deep. An overlay holding *only*
 *     `provider.stub.models.stub-model.options` still reached the stub, so the
 *     `baseURL` and `npm` from the user's own file survived.
 */

export type ModelOverride = {
  /** Sampling temperature, as the provider understands it. */
  temperature?: number;
  /** Nucleus sampling. */
  topP?: number;
  /** Upper bound for the answer, sent as `max_tokens`. */
  maxOutput?: number;
};

/** Keyed by the routed model id, `<providerID>/<modelID>`. */
export type ModelOverrides = Record<string, ModelOverride>;

type OverlayModel = {
  options?: Record<string, unknown>;
  limit?: { context?: number; output?: number };
};

type Overlay = {
  provider?: Record<string, { models?: Record<string, OverlayModel> }>;
};

/** Where the overlay is written. Next to the database, not in the user's config. */
export function getOverridesPath(): string {
  return process.env.CLOUDCLI_OPENCODE_OVERRIDES
    || path.join(os.homedir(), '.cloudcli', 'opencode-overrides.json');
}

/** Splits `ollama/qwen3.8:27b` into provider and model; a model id may contain `/`. */
function splitModelValue(value: string): { providerId: string; modelId: string } | null {
  const separator = value.indexOf('/');
  if (separator <= 0 || separator === value.length - 1) {
    return null;
  }

  return {
    providerId: value.slice(0, separator),
    modelId: value.slice(separator + 1),
  };
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

async function readOverlay(): Promise<Overlay> {
  try {
    const text = await fs.readFile(getOverridesPath(), 'utf8');
    const parsed = JSON.parse(text) as Overlay;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    // Not written yet, or damaged: start from an empty overlay rather than
    // failing a settings page over it.
    return {};
  }
}

/** Every override CloudCLI currently applies, keyed by `<provider>/<model>`. */
export async function readModelOverrides(): Promise<ModelOverrides> {
  const overlay = await readOverlay();
  const overrides: ModelOverrides = {};

  for (const [providerId, provider] of Object.entries(overlay.provider ?? {})) {
    for (const [modelId, model] of Object.entries(provider?.models ?? {})) {
      const override: ModelOverride = {};
      const temperature = asNumber(model?.options?.temperature);
      const topP = asNumber(model?.options?.top_p);
      const maxOutput = asNumber(model?.limit?.output);

      if (temperature !== undefined) override.temperature = temperature;
      if (topP !== undefined) override.topP = topP;
      if (maxOutput !== undefined) override.maxOutput = maxOutput;

      if (Object.keys(override).length > 0) {
        overrides[`${providerId}/${modelId}`] = override;
      }
    }
  }

  return overrides;
}

/**
 * Stores the settings for one model. A field left `undefined` is removed, so a
 * cleared input goes back to whatever the model itself defines.
 *
 * `limit` needs `context` next to `output` to satisfy OpenCode's schema, so a
 * context already in the overlay is kept and only replaced when the caller has
 * a value of its own.
 */
export async function writeModelOverride(
  modelValue: string,
  override: ModelOverride,
): Promise<ModelOverrides> {
  const split = splitModelValue(modelValue);
  if (!split) {
    throw new Error(`Not a routed model id: "${modelValue}"`);
  }

  const overlay = await readOverlay();
  overlay.provider ??= {};
  overlay.provider[split.providerId] ??= {};
  overlay.provider[split.providerId].models ??= {};

  const models = overlay.provider[split.providerId].models as Record<string, OverlayModel>;
  const model: OverlayModel = models[split.modelId] ?? {};
  const options = { ...(model.options ?? {}) };

  if (override.temperature === undefined) {
    delete options.temperature;
  } else {
    options.temperature = override.temperature;
  }

  if (override.topP === undefined) {
    delete options.top_p;
  } else {
    options.top_p = override.topP;
  }

  const limit = { ...(model.limit ?? {}) };
  if (override.maxOutput === undefined) {
    delete limit.output;
  } else {
    limit.output = override.maxOutput;
  }

  const next: OverlayModel = {};
  if (Object.keys(options).length > 0) next.options = options;
  // `output` alone is not a valid limit; without it the whole limit goes.
  if (limit.output !== undefined) next.limit = limit;

  if (Object.keys(next).length > 0) {
    models[split.modelId] = next;
  } else {
    delete models[split.modelId];
    if (Object.keys(models).length === 0) {
      delete overlay.provider[split.providerId];
    }
  }

  const target = getOverridesPath();
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, `${JSON.stringify(overlay, null, 2)}\n`, 'utf8');

  return readModelOverrides();
}

/**
 * Environment for an OpenCode run, so it reads the overlay.
 *
 * `OPENCODE_CONFIG` names a single file, so a value the user set themselves is
 * left alone - overwriting it would silently drop their config. The settings
 * page says so when that happens.
 */
export async function getOverridesEnv(): Promise<Record<string, string>> {
  if ((process.env.OPENCODE_CONFIG || '').trim()) {
    return {};
  }

  const target = getOverridesPath();
  try {
    await fs.access(target);
  } catch {
    return {};
  }

  return { OPENCODE_CONFIG: target };
}
