/**
 * Antigravity Models Provider
 *
 * Implements IProviderModels for the Antigravity CLI (agy).
 * Provides supported model catalog (with effort levels) and active model resolution.
 *
 * @module antigravity-models.provider
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import type { IProviderModels } from '@/shared/interfaces.js';
import type {
  ProviderCurrentActiveModel,
  ProviderModelOption,
  ProviderModelsDefinition,
} from '@/shared/types.js';
import {
  buildDefaultProviderCurrentActiveModel,
  readObjectRecord,
  readOptionalString,
} from '@/shared/utils.js';

import { tryResolveEnginePath } from './antigravity-engine-path.js';

const execFileAsync = promisify(execFile);

/**
 * Standard reasoning effort descriptions.
 */
const EFFORT_DESCRIPTIONS: Record<string, string> = {
  low: 'Faster, less detailed reasoning',
  medium: 'Balanced reasoning for most tasks',
  high: 'Maximum depth reasoning for complex tasks',
};

const STANDARD_EFFORT_CONFIG = {
  default: 'high',
  values: [
    { value: 'low', description: EFFORT_DESCRIPTIONS.low },
    { value: 'medium', description: EFFORT_DESCRIPTIONS.medium },
    { value: 'high', description: EFFORT_DESCRIPTIONS.high },
  ],
};

/**
 * Builtin fallback model definitions when `agy models` cannot be queried.
 */
export const ANTIGRAVITY_BUILTIN_MODELS: ProviderModelsDefinition = {
  OPTIONS: [
    {
      value: 'gemini-3.7-flash-high',
      label: 'Gemini 3.7 Flash (High)',
      description: 'Google Gemini 3.7 Flash with high reasoning effort',
      effort: STANDARD_EFFORT_CONFIG,
    },
    {
      value: 'gemini-3.7-flash-medium',
      label: 'Gemini 3.7 Flash (Medium)',
      description: 'Google Gemini 3.7 Flash with medium reasoning effort',
      effort: STANDARD_EFFORT_CONFIG,
    },
    {
      value: 'gemini-3.7-flash-low',
      label: 'Gemini 3.7 Flash (Low)',
      description: 'Google Gemini 3.7 Flash with low reasoning effort',
      effort: STANDARD_EFFORT_CONFIG,
    },
    {
      value: 'gemini-3.6-flash-high',
      label: 'Gemini 3.6 Flash (High)',
      description: 'Google Gemini 3.6 Flash with high reasoning effort',
      effort: STANDARD_EFFORT_CONFIG,
    },
    {
      value: 'gemini-3.6-flash-medium',
      label: 'Gemini 3.6 Flash (Medium)',
      description: 'Google Gemini 3.6 Flash with medium reasoning effort',
      effort: STANDARD_EFFORT_CONFIG,
    },
    {
      value: 'gemini-3.1-pro-high',
      label: 'Gemini 3.1 Pro (High)',
      description: 'Google Gemini 3.1 Pro for complex architecture and deep reasoning',
      effort: STANDARD_EFFORT_CONFIG,
    },
    {
      value: 'claude-sonnet-4-6',
      label: 'Claude Sonnet 4.6 (Thinking)',
      description: 'Anthropic Claude Sonnet 4.6 with extended thinking',
      effort: STANDARD_EFFORT_CONFIG,
    },
    {
      value: 'claude-opus-4-6-thinking',
      label: 'Claude Opus 4.6 (Thinking)',
      description: 'Anthropic Claude Opus 4.6 with maximum reasoning capability',
      effort: STANDARD_EFFORT_CONFIG,
    },
    {
      value: 'gpt-oss-120b-medium',
      label: 'GPT-OSS 120B (Medium)',
      description: 'Open-weight 120B foundation model',
      effort: STANDARD_EFFORT_CONFIG,
    },
  ],
  DEFAULT: 'gemini-3.7-flash-high',
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

    const lines = stdout.split(/\r?\n/);
    const options: ProviderModelOption[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('Fetching')) {
        continue;
      }

      // Format is `<modelId>\t<Label>` or `<modelId>   <Label>`
      const parts = trimmed.split(/\t+|\s{2,}/);
      if (parts.length >= 2) {
        const value = parts[0]?.trim() || '';
        const label = parts[1]?.trim() || value;

        if (value) {
          options.push({
            value,
            label,
            description: `${label} via Google Antigravity CLI`,
            effort: STANDARD_EFFORT_CONFIG,
          });
        }
      } else if (parts.length === 1 && parts[0]?.trim()) {
        const value = parts[0].trim();
        options.push({
          value,
          label: value,
          description: `${value} via Google Antigravity CLI`,
          effort: STANDARD_EFFORT_CONFIG,
        });
      }
    }

    if (options.length > 0) {
      const defaultModel = options.find((o) => o.value.includes('3.7-flash-high'))?.value
        ?? options[0]?.value
        ?? 'gemini-3.7-flash-high';

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
 * Reads user's default model setting from `~/.gemini/antigravity-cli/settings.json`.
 */
function readDefaultModelFromSettings(): string | null {
  try {
    const settingsPath = path.join(os.homedir(), '.gemini', 'antigravity-cli', 'settings.json');
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
   * reports the settings.json default or the catalog default.
   */
  async getCurrentActiveModel(_sessionId?: string): Promise<ProviderCurrentActiveModel> {
    const settingsModel = readDefaultModelFromSettings();
    if (settingsModel) {
      return { model: settingsModel };
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
