/**
 * Antigravity Models Provider
 *
 * Implements IProviderModels for the Antigravity CLI (agy).
 * Provides the supported model catalog (with effort levels) and active model
 * resolution. Both the builtin fallback and the `agy models` output are
 * collapsed into base models whose effort tiers ride on the Reasoning picker
 * (see antigravity-model-effort).
 *
 * @module antigravity-models.provider
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import { promisify } from 'node:util';

import type { IProviderModels } from '@/shared/interfaces.js';
import type {
  ProviderCurrentActiveModel,
  ProviderModelsDefinition,
} from '@/shared/types.js';
import {
  buildDefaultProviderCurrentActiveModel,
  readObjectRecord,
  readOptionalString,
} from '@/shared/utils.js';

import { getAntigravitySettingsPath } from './antigravity-data-root.js';
import { tryResolveEnginePath } from './antigravity-engine-path.js';
import {
  dedupeAntigravityVariantModels,
  splitModelEffortSuffix,
  type AntigravityRawModelEntry,
} from './antigravity-model-effort.js';

const execFileAsync = promisify(execFile);

/**
 * Builtin raw model rows mirroring `agy models` output, used verbatim as the
 * fallback catalog when the CLI cannot be queried. Variant families with two
 * or more tiers collapse into base models at load time, so the picker lists
 * one entry per adjustable model with its Reasoning tiers; single-variant
 * rows (gpt-oss-120b-medium) and claude passthroughs keep their original id
 * and label with no Reasoning options. Only the first row of each collapsed
 * family carries a description; it becomes the base model's description.
 */
const ANTIGRAVITY_BUILTIN_RAW_MODELS: AntigravityRawModelEntry[] = [
  { value: 'gemini-3.8-flash-high', label: 'Gemini 3.8 Flash (High)', description: 'Google Gemini 3.8 Flash' },
  { value: 'gemini-3.8-flash-medium', label: 'Gemini 3.8 Flash (Medium)' },
  { value: 'gemini-3.8-flash-low', label: 'Gemini 3.8 Flash (Low)' },
  { value: 'gemini-3.7-flash-high', label: 'Gemini 3.7 Flash (High)', description: 'Google Gemini 3.7 Flash' },
  { value: 'gemini-3.7-flash-medium', label: 'Gemini 3.7 Flash (Medium)' },
  { value: 'gemini-3.7-flash-low', label: 'Gemini 3.7 Flash (Low)' },
  { value: 'gemini-3.6-flash-high', label: 'Gemini 3.6 Flash (High)', description: 'Google Gemini 3.6 Flash' },
  { value: 'gemini-3.6-flash-medium', label: 'Gemini 3.6 Flash (Medium)' },
  { value: 'gemini-3.6-flash-low', label: 'Gemini 3.6 Flash (Low)' },
  { value: 'gemini-3.1-pro-high', label: 'Gemini 3.1 Pro (High)', description: 'Google Gemini 3.1 Pro for complex architecture and deep reasoning' },
  { value: 'gemini-3.1-pro-low', label: 'Gemini 3.1 Pro (Low)' },
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (Thinking)', description: 'Anthropic Claude Sonnet 4.6 with extended thinking' },
  { value: 'claude-opus-4-6-thinking', label: 'Claude Opus 4.6 (Thinking)', description: 'Anthropic Claude Opus 4.6 with maximum reasoning capability' },
  { value: 'gpt-oss-120b-medium', label: 'GPT-OSS 120B (Medium)', description: 'Open-weight 120B foundation model' },
];

/** Catalog default, kept identical in the builtin and dynamic paths. */
const DEFAULT_BASE_MODEL = 'gemini-3.7-flash';

/**
 * Builtin fallback model definitions when `agy models` cannot be queried.
 */
export const ANTIGRAVITY_BUILTIN_MODELS: ProviderModelsDefinition = {
  OPTIONS: dedupeAntigravityVariantModels(ANTIGRAVITY_BUILTIN_RAW_MODELS),
  DEFAULT: DEFAULT_BASE_MODEL,
};

/**
 * Fetches available models dynamically by invoking `agy models`.
 */
async function fetchModelsFromCli(): Promise<ProviderModelsDefinition | null> {
  const enginePath = tryResolveEnginePath();
  if (!enginePath) {
    return null;
  }

  try {
    const { stdout } = await execFileAsync(enginePath, ['models'], {
      encoding: 'utf8',
      timeout: 8000,
    });

    const entries: AntigravityRawModelEntry[] = [];

    for (const line of stdout.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('Fetching')) {
        continue;
      }

      // Format is `<modelId>\t<Label>` or `<modelId>   <Label>`
      const parts = trimmed.split(/\t+|\s{2,}/);
      const value = parts[0]?.trim() || '';
      if (!value) {
        continue;
      }

      entries.push({
        value,
        label: parts.length >= 2 ? (parts[1]?.trim() || value) : value,
      });
    }

    if (entries.length > 0) {
      const options = dedupeAntigravityVariantModels(entries).map((option) => ({
        ...option,
        description: option.description ?? `${option.label} via Google Antigravity CLI`,
      }));

      const defaultModel = options.find((o) => o.value === DEFAULT_BASE_MODEL)?.value
        ?? options[0]?.value
        ?? DEFAULT_BASE_MODEL;

      return {
        OPTIONS: options,
        DEFAULT: defaultModel,
      };
    }
  } catch {
    // Dynamic query failed, fall back to builtin models
  }

  return null;
}

/**
 * Reads user's default model setting from the agy data root's `settings.json`.
 */
function readDefaultModelFromSettings(): string | null {
  try {
    const settingsPath = getAntigravitySettingsPath();
    if (!fs.existsSync(settingsPath)) {
      return null;
    }

    const content = fs.readFileSync(settingsPath, 'utf8');
    const settings = readObjectRecord(JSON.parse(content));
    return readOptionalString(settings?.model) ?? null;
  } catch {
    return null;
  }
}

export class AntigravityProviderModels implements IProviderModels {
  private cachedModels: ProviderModelsDefinition | null = null;
  private cacheExpiry: number = 0;

  /**
   * Returns supported Antigravity models, dynamically loaded or from builtin defaults.
   */
  async getSupportedModels(): Promise<ProviderModelsDefinition> {
    const now = Date.now();
    if (this.cachedModels && now < this.cacheExpiry) {
      return this.cachedModels;
    }

    const cliModels = await fetchModelsFromCli();
    this.cachedModels = cliModels ?? ANTIGRAVITY_BUILTIN_MODELS;
    this.cacheExpiry = now + 5 * 60 * 1000; // Cache for 5 minutes

    return this.cachedModels;
  }

  /**
   * Returns the current active model for a session or default.
   *
   * Session-scoped model memory is owned by providerModelsService
   * (setSessionModel / resolveResumeModel) on the chat path; this facet only
   * reports the settings.json default or the catalog default. agy stores the
   * full suffixed id in settings.json, so the tier is stripped to match the
   * base-model catalog.
   */
  async getCurrentActiveModel(_sessionId?: string): Promise<ProviderCurrentActiveModel> {
    const settingsModel = readDefaultModelFromSettings();
    if (settingsModel) {
      const { base } = splitModelEffortSuffix(settingsModel);
      return { model: base };
    }

    return buildDefaultProviderCurrentActiveModel(await this.getSupportedModels());
  }

  /**
   * Clears the models cache.
   */
  clearCache(): void {
    this.cachedModels = null;
    this.cacheExpiry = 0;
  }
}
