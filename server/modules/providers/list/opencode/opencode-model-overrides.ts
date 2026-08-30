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
  /**
   * Context window, only ever written to satisfy OpenCode's schema next to
   * `maxOutput` - never a setting of its own, and not reported back as one.
   */
  contextLimit?: number;
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

/**
 * Names that are not keys but reach into the prototype chain. The routed id
 * comes from a request body, and `overlay.provider['__proto__'].models ??= {}`
 * would write onto `Object.prototype` instead of the overlay - every object in
 * the process would carry a `models` from then on.
 */
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** Splits `ollama/qwen3.8:27b` into provider and model; a model id may contain `/`. */
function splitModelValue(value: string): { providerId: string; modelId: string } | null {
  const separator = value.indexOf('/');
  if (separator <= 0 || separator === value.length - 1) {
    return null;
  }

  const providerId = value.slice(0, separator);
  const modelId = value.slice(separator + 1);
  if (UNSAFE_KEYS.has(providerId) || UNSAFE_KEYS.has(modelId)) {
    return null;
  }

  return { providerId, modelId };
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
 * `limit` needs BOTH keys. OpenCode validates every config file on its own,
 * before any merge, so a lone `output` does not get its `context` filled in
 * from the catalog - it fails the whole file:
 *
 *   Error: Configuration is invalid at ...\opencode-overrides.json
 *   ↳ Missing key provider.ollama.models.gpt-oss:20b.limit.context
 *
 * That is not a warning: `opencode models` refuses to run, and so does every
 * session. A context already in the overlay is therefore kept, the caller may
 * replace it, and without one an output override is refused rather than
 * written.
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
  if (override.contextLimit !== undefined) {
    limit.context = override.contextLimit;
  }

  if (override.maxOutput === undefined) {
    delete limit.output;
  } else {
    if (limit.context === undefined) {
      throw new Error(
        `Cannot set an output limit for "${modelValue}": OpenCode needs the context window next to it, and none is known.`,
      );
    }
    limit.output = override.maxOutput;
  }

  const next: OverlayModel = {};
  if (Object.keys(options).length > 0) next.options = options;
  // Only ever both keys, or no limit at all - see the note above.
  if (limit.output !== undefined) next.limit = { context: limit.context, output: limit.output };

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
