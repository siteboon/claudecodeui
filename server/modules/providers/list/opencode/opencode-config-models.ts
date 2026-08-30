import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { parseJsonc } from '@/modules/providers/list/opencode/jsonc-parse.js';
import type { ProviderModelOption } from '@/shared/types.js';

/**
 * Models the local OpenCode installation accepts on top of its curated catalog,
 * read from the user's own OpenCode configuration.
 *
 * OpenCode routes by `<providerID>/<modelID>`, and it only starts a model it
 * knows. For the providers it takes from models.dev that is the published
 * catalog; for a provider the user declares themselves - a local Ollama through
 * `@ai-sdk/openai-compatible`, an OpenRouter key, an internal gateway - the
 * config file is the only list that exists. Those models are invisible here
 * today, which is the gap this closes.
 *
 * Asking the service instead (`GET /api/tags` on a local Ollama, say) looks
 * like the more direct route and is the wrong one: it reports what is
 * installed, not what OpenCode will run. Measured on an installation with
 * seven pulled Ollama models and four of them configured, `opencode models`
 * lists exactly the four, and `opencode run --model ollama/<not configured>`
 * fails inside OpenCode without a single request reaching Ollama. Listing all
 * seven would offer three that cannot start.
 *
 * Reading the file is also what keeps this cheap: `opencode models` is the
 * authoritative answer but takes ~5 s per call, far too slow for a catalog
 * that is fetched every time a model dropdown opens.
 */

/**
 * Config files in the order OpenCode looks them up; the first one that exists
 * wins. `OPENCODE_CONFIG` names a file directly, otherwise the global config
 * directory is used - all four lookups appear as strings in the OpenCode
 * binary.
 */
function getConfigCandidates(): string[] {
  const explicit = (process.env.OPENCODE_CONFIG || '').trim();
  if (explicit) {
    return [explicit];
  }

  const configHome = (process.env.XDG_CONFIG_HOME || '').trim()
    || path.join(os.homedir(), '.config');
  const directory = path.join(configHome, 'opencode');

  return [
    path.join(directory, 'opencode.jsonc'),
    path.join(directory, 'opencode.json'),
  ];
}

/**
 * `CLOUDCLI_OPENCODE_CONFIG_MODELS=0` (or `false`/`off`/`no`) keeps the catalog
 * to the curated list, for anyone who does not want their config read.
 */
function isEnabled(): boolean {
  const flag = (process.env.CLOUDCLI_OPENCODE_CONFIG_MODELS ?? '').trim().toLowerCase();
  return !['0', 'false', 'off', 'no'].includes(flag);
}

/**
 * The catalog is read whenever a model dropdown opens. A short cache keeps that
 * from turning into a file read per render, while an edited config still shows
 * up promptly.
 */
const CACHE_TTL_MS = 30_000;

type ConfiguredModel = {
  name?: unknown;
};

type ConfiguredProvider = {
  name?: unknown;
  models?: Record<string, ConfiguredModel> | unknown;
};

type OpenCodeConfig = {
  provider?: Record<string, ConfiguredProvider> | unknown;
};

let cachedOptions: ProviderModelOption[] = [];
let cachedAt = 0;

function asText(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function toOptions(config: OpenCodeConfig): ProviderModelOption[] {
  const providers = config.provider;
  if (!providers || typeof providers !== 'object') {
    return [];
  }

  const options: ProviderModelOption[] = [];

  for (const [providerId, rawProvider] of Object.entries(providers as Record<string, ConfiguredProvider>)) {
    if (!providerId || !rawProvider || typeof rawProvider !== 'object') {
      continue;
    }

    const models = rawProvider.models;
    if (!models || typeof models !== 'object') {
      continue;
    }

    const providerLabel = asText(rawProvider.name) || providerId;

    for (const [modelId, rawModel] of Object.entries(models as Record<string, ConfiguredModel>)) {
      if (!modelId) {
        continue;
      }

      const modelLabel = rawModel && typeof rawModel === 'object'
        ? asText(rawModel.name) || modelId
        : modelId;

      options.push({
        // The provider prefix is what OpenCode routes on.
        value: `${providerId}/${modelId}`,
        label: modelLabel,
        description: providerLabel,
        isCustom: false,
      });
    }
  }

  options.sort((a, b) => a.value.localeCompare(b.value));
  return options;
}

/**
 * Models declared in the local OpenCode config, or an empty list when there is
 * no config, it cannot be read, or it holds no providers. Never throws.
 */
export async function readConfiguredOpenCodeModels(): Promise<ProviderModelOption[]> {
  if (!isEnabled()) {
    return [];
  }

  if (Date.now() - cachedAt < CACHE_TTL_MS) {
    return cachedOptions;
  }

  let options: ProviderModelOption[] = [];

  for (const candidate of getConfigCandidates()) {
    let text: string;
    try {
      text = await fs.readFile(candidate, 'utf8');
    } catch {
      // Not this one (or not readable): try the next candidate.
      continue;
    }

    const config = parseJsonc<OpenCodeConfig>(text);
    // A file that exists but does not parse is still the file OpenCode uses;
    // moving on to the next candidate would report a config that is not live.
    options = config ? toOptions(config) : [];
    break;
  }

  cachedOptions = options;
  cachedAt = Date.now();
  return cachedOptions;
}

/** Drops the cache so the next call reads the file again. For tests. */
export function resetOpenCodeConfigModelCache(): void {
  cachedOptions = [];
  cachedAt = 0;
}
