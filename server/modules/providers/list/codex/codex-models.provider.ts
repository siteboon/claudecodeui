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

/**
 * Maps one entry of a Codex `model_catalog_json` file onto a selectable model.
 *
 * Only entries Codex itself lists in `/model` are imported: the picker sets
 * `show_in_picker` for `visibility: "list"` alone, so `hide`, `none` and
 * missing visibility are all excluded, mirroring the TUI's model list.
 */
const toCatalogModelOption = (rawEntry: unknown): ProviderModelOption | null => {
  const entry = readObjectRecord(rawEntry);
  if (!entry) {
    return null;
  }

  const visibility = readOptionalString(entry.visibility)?.toLowerCase();
  if (visibility !== 'list') {
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
 * Parses a Codex `model_catalog_json` document into ordered model options.
 *
 * Returns null when the document is unusable — invalid JSON, no `models`
 * array, or no selectable entries — so callers can surface "no usable
 * catalog" instead of an empty import.
 */
const parseCodexCatalogContent = (rawContent: string): ProviderModelOption[] | null => {
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
 * The supported-model list stays curated and immutable; Codex's own
 * `model_catalog_json` is only exposed through `readExternalCatalog()` so the
 * catalog-sync workflow can import its entries as user-editable custom rows.
 */
export class CodexProviderModels implements IProviderModels {
  /** Resolved per instance so tests can point the adapter at a throwaway home. */
  private readonly configPath: string;

  constructor(options: { configPath?: string } = {}) {
    this.configPath = options.configPath ?? path.join(os.homedir(), '.codex', 'config.toml');
  }

  async getSupportedModels(): Promise<ProviderModelsDefinition> {
    return CODEX_PREDEFINED_MODELS;
  }

  /**
   * Reads the models defined by the `model_catalog_json` named in
   * `~/.codex/config.toml`, or null when the config or catalog is missing or
   * unusable.
   */
  async readExternalCatalog(): Promise<ProviderModelsDefinition | null> {
    const config = await this.readCodexConfig();
    if (!config) {
      return null;
    }

    const catalogPath = readOptionalString(config.model_catalog_json);
    if (!catalogPath) {
      return null;
    }

    try {
      const raw = await readFile(expandHomePath(catalogPath), 'utf8');
      const options = parseCodexCatalogContent(raw);
      if (!options) {
        return null;
      }

      const configuredModel = readOptionalString(config.model);
      // Only picker-visible entries are importable. A configured default that
      // the catalog hides or does not declare stays the DEFAULT value but must
      // never become a selectable custom row through catalog sync.
      const defaultModel = configuredModel
        ?? (options.some((option) => option.value === CODEX_PREDEFINED_MODELS.DEFAULT)
          ? CODEX_PREDEFINED_MODELS.DEFAULT
          : options[0].value);

      return {
        OPTIONS: options,
        DEFAULT: defaultModel,
      };
    } catch {
      return null;
    }
  }

  private async readCodexConfig(): Promise<Record<string, unknown> | null> {
    try {
      const raw = await readFile(this.configPath, 'utf8');
      return readObjectRecord(TOML.parse(raw));
    } catch {
      return null;
    }
  }

  async getCurrentActiveModel(): Promise<ProviderCurrentActiveModel> {
    const config = await this.readCodexConfig();
    const model = readOptionalString(config?.model);
    if (model) {
      return { model };
    }

    return buildDefaultProviderCurrentActiveModel(await this.getSupportedModels());
  }
}
