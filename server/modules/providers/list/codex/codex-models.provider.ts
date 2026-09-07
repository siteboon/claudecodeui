import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import TOML from '@iarna/toml';

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

/** Curated Codex catalog shipped as immutable CloudCLI defaults. */
export const CODEX_PREDEFINED_MODELS: ProviderModelsDefinition = {
  OPTIONS: [
    {
      value: 'gpt-6-astra',
      label: 'GPT-6 Astra',
      description: 'Our most capable model for complex, demanding work.',
      effort: {
        default: 'low',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
          { value: 'xhigh' },
          { value: 'max' },
          { value: 'ultra' },
        ],
      },
    },
    {
      value: 'gpt-5.6-sol',
      label: 'GPT-5.6 Sol',
      description: 'Latest frontier agentic coding model.',
      effort: {
        default: 'low',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
          { value: 'xhigh' },
          { value: 'max' },
          { value: 'ultra' },
        ],
      },
    },
    {
      value: 'gpt-5.6-terra',
      label: 'GPT-5.6 Terra',
      description: 'Balanced agentic coding model for everyday work.',
      effort: {
        default: 'medium',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
          { value: 'xhigh' },
          { value: 'max' },
          { value: 'ultra' },
        ],
      },
    },
    {
      value: 'gpt-5.6-luna',
      label: 'GPT-5.6 Luna',
      description: 'Fast and affordable agentic coding model.',
      effort: {
        default: 'medium',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
          { value: 'xhigh' },
          { value: 'max' },
        ],
      },
    },
    {
      value: 'gpt-5.5',
      label: 'GPT-5.5',
      description: 'Frontier model for complex coding, research, and real-world work.',
      effort: {
        default: 'medium',
        values: [{ value: 'low' }, { value: 'medium' }, { value: 'high' }, { value: 'xhigh' }],
      },
    },
    {
      value: 'gpt-5.4',
      label: 'GPT-5.4',
      description: 'Strong model for everyday coding.',
      effort: {
        default: 'medium',
        values: [{ value: 'low' }, { value: 'medium' }, { value: 'high' }, { value: 'xhigh' }],
      },
    },
    {
      value: 'gpt-5.4-mini',
      label: 'GPT-5.4 Mini',
      description: 'Small, fast, and cost-efficient model for simpler coding tasks.',
      effort: {
        default: 'medium',
        values: [{ value: 'low' }, { value: 'medium' }, { value: 'high' }, { value: 'xhigh' }],
      },
    },
  ],
  DEFAULT: 'gpt-5.6-sol',
};

const isHiddenCatalogVisibility = (rawVisibility: unknown): boolean => {
  const visibility = readOptionalString(rawVisibility)?.toLowerCase();
  return visibility === 'hide' || visibility === 'hidden';
};

/**
 * Maps one entry of a Codex `model_catalog_json` file onto a selectable model.
 *
 * Entries that lack a slug or are explicitly hidden from Codex's own picker
 * (`visibility = "hide"`) are dropped, mirroring which models the TUI shows.
 */
const toCatalogModelOption = (rawEntry: unknown): ProviderModelOption | null => {
  const entry = readObjectRecord(rawEntry);
  if (!entry || isHiddenCatalogVisibility(entry.visibility)) {
    return null;
  }

  const slug = readOptionalString(entry.slug);
  if (!slug) {
    return null;
  }

  const effortValues = readCatalogEffortValues(entry.supported_reasoning_levels);
  const defaultEffort = readOptionalString(entry.default_reasoning_level);
  const description = readOptionalString(entry.description);

  return {
    value: slug,
    label: readOptionalString(entry.display_name) ?? slug,
    ...(description ? { description } : {}),
    ...(effortValues.length > 0
      ? { effort: { ...(defaultEffort ? { default: defaultEffort } : {}), values: effortValues } }
      : {}),
  };
};

const readCatalogEffortValues = (rawLevels: unknown): { value: string; description?: string }[] => {
  if (!Array.isArray(rawLevels)) {
    return [];
  }

  return rawLevels.flatMap((rawLevel) => {
    const level = readObjectRecord(rawLevel);
    const effort = readOptionalString(level?.effort);
    if (!effort) {
      return [];
    }

    const description = readOptionalString(level?.description);
    return [{
      value: effort,
      ...(description ? { description } : {}),
    }];
  });
};

/**
 * Parses a Codex `model_catalog_json` document into ordered catalog options.
 *
 * Returns `null` whenever the document is unusable — invalid JSON, a missing
 * `models` array, or an array that maps to no selectable models — so callers
 * fall back to the curated catalog instead of surfacing an empty picker.
 */
const parseCodexCatalogFile = (rawContent: string): ProviderModelOption[] | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawContent);
  } catch {
    return null;
  }

  const root = readObjectRecord(parsed);
  if (!root || !Array.isArray(root.models)) {
    return null;
  }

  const seen = new Set<string>();
  const options: ProviderModelOption[] = [];
  for (const rawEntry of root.models) {
    const option = toCatalogModelOption(rawEntry);
    if (!option || seen.has(option.value)) {
      continue;
    }
    seen.add(option.value);
    options.push(option);
  }

  return options.length > 0 ? options : null;
};

const expandHomePath = (rawPath: string): string => (
  rawPath === '~' || rawPath.startsWith('~/')
    ? path.join(os.homedir(), rawPath.slice(1))
    : rawPath
);

/**
 * Provider registry model adapter for the Codex predefined catalog and active
 * config.
 *
 * The supported-model list deliberately follows the Codex CLI itself: when
 * `~/.codex/config.toml` names a `model_catalog_json`, that file's entries are
 * the models Codex's `/model` picker offers and this adapter reports the same
 * list. Any failure reading the config or catalog falls back to the curated
 * `CODEX_PREDEFINED_MODELS` catalog so the picker never comes up empty.
 */
export class CodexProviderModels implements IProviderModels {
  /** Resolved lazily so tests can point the adapter at a throwaway home. */
  private readonly configPath: string;

  constructor(options: { configPath?: string } = {}) {
    this.configPath = options.configPath ?? path.join(os.homedir(), '.codex', 'config.toml');
  }

  private async readCodexConfig(): Promise<Record<string, unknown> | null> {
    try {
      const raw = await readFile(this.configPath, 'utf8');
      return readObjectRecord(TOML.parse(raw));
    } catch {
      return null;
    }
  }

  private async readCatalogOptions(config: Record<string, unknown>): Promise<ProviderModelOption[] | null> {
    const catalogPath = readOptionalString(config.model_catalog_json);
    if (!catalogPath) {
      return null;
    }

    try {
      const raw = await readFile(expandHomePath(catalogPath), 'utf8');
      return parseCodexCatalogFile(raw);
    } catch {
      return null;
    }
  }

  async getSupportedModels(): Promise<ProviderModelsDefinition> {
    const config = await this.readCodexConfig();
    if (!config) {
      return CODEX_PREDEFINED_MODELS;
    }

    const catalogOptions = await this.readCatalogOptions(config);
    if (!catalogOptions) {
      return CODEX_PREDEFINED_MODELS;
    }

    const configuredModel = readOptionalString(config.model);
    if (configuredModel && !catalogOptions.some((option) => option.value === configuredModel)) {
      // Keep the model Codex is configured to run selectable even when the
      // catalog file does not declare it.
      catalogOptions.push({ value: configuredModel, label: configuredModel });
    }

    const defaultModel = configuredModel
      ?? (catalogOptions.some((option) => option.value === CODEX_PREDEFINED_MODELS.DEFAULT)
        ? CODEX_PREDEFINED_MODELS.DEFAULT
        : catalogOptions[0].value);

    return {
      OPTIONS: catalogOptions,
      DEFAULT: defaultModel,
    };
  }

  async getCurrentActiveModel(): Promise<ProviderCurrentActiveModel> {
    try {
      const config = await this.readCodexConfig();
      const model = readOptionalString(config?.model);
      if (model) {
        return { model };
      }
    } catch {
      // Fall through to the curated default.
    }

    return buildDefaultProviderCurrentActiveModel(await this.getSupportedModels());
  }
}
