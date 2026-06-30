import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { IProviderModels } from '@/shared/interfaces.js';
import type {
  ProviderChangeActiveModelInput,
  ProviderCurrentActiveModel,
  ProviderModelsDefinition,
  ProviderSessionActiveModelChange,
} from '@/shared/types.js';
import {
  buildDefaultProviderCurrentActiveModel,
  readOptionalString,
  writeProviderSessionActiveModelChange,
} from '@/shared/utils.js';

export const HERMES_CONFIGURED_MODEL = '__hermes_configured_model__';

export const HERMES_FALLBACK_MODELS: ProviderModelsDefinition = {
  OPTIONS: [
    {
      value: HERMES_CONFIGURED_MODEL,
      label: 'Configured in Hermes',
      description: 'Uses the provider and model selected with `hermes model`.',
    },
  ],
  DEFAULT: HERMES_CONFIGURED_MODEL,
};

const HERMES_CONFIG_PATH = path.join(os.homedir(), '.hermes', 'config.yaml');

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripScalar(raw: string): string | null {
  let value = raw.trim();
  // Drop an unquoted trailing comment.
  if (!value.startsWith('"') && !value.startsWith("'")) {
    const comment = value.search(/\s#/);
    if (comment >= 0) {
      value = value.slice(0, comment).trim();
    }
  }
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return value.trim() || null;
}

const indentOf = (line: string): number => line.length - line.replace(/^\s+/, '').length;

// Minimal, indentation-aware reader for the flat `key: value` and one-level
// nested (`section:`\n`  key: value`) shapes used by ~/.hermes/config.yaml.
// Avoids the fragile single-regex lookahead that could terminate a section
// early and silently miss the configured model.
export function readYamlPath(content: string, pathParts: string[]): string | null {
  const lines = content.split(/\r?\n/);

  if (pathParts.length === 1) {
    const re = new RegExp(`^\\s*${escapeRegex(pathParts[0])}\\s*:\\s*(.*)$`);
    for (const line of lines) {
      if (!line.trim() || line.trim().startsWith('#')) continue;
      const match = line.match(re);
      if (match) return stripScalar(match[1]);
    }
    return null;
  }

  const [section, key] = pathParts;
  const sectionRe = new RegExp(`^(\\s*)${escapeRegex(section)}\\s*:\\s*$`);
  const keyRe = new RegExp(`^\\s*${escapeRegex(key)}\\s*:\\s*(.*)$`);
  let sectionIndent: number | null = null;

  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith('#')) continue;

    if (sectionIndent === null) {
      const match = line.match(sectionRe);
      if (match) sectionIndent = match[1].length;
      continue;
    }

    // Left the nested block once indentation returns to the section level or less.
    if (indentOf(line) <= sectionIndent) {
      sectionIndent = line.match(sectionRe)?.[1].length ?? null;
      continue;
    }

    const match = line.match(keyRe);
    if (match) return stripScalar(match[1]);
  }

  return null;
}

export class HermesProviderModels implements IProviderModels {
  async getSupportedModels(): Promise<ProviderModelsDefinition> {
    const activeModel = await this.readConfiguredModel();
    if (!activeModel) {
      return HERMES_FALLBACK_MODELS;
    }

    const options = [
      { value: activeModel, label: activeModel },
      ...HERMES_FALLBACK_MODELS.OPTIONS,
    ];

    return {
      OPTIONS: options,
      DEFAULT: activeModel,
    };
  }

  async getCurrentActiveModel(): Promise<ProviderCurrentActiveModel> {
    const configured = await this.readConfiguredModel();
    if (configured) {
      return { model: configured };
    }

    return buildDefaultProviderCurrentActiveModel(await this.getSupportedModels());
  }

  async changeActiveModel(input: ProviderChangeActiveModelInput): Promise<ProviderSessionActiveModelChange> {
    if (input.model === HERMES_CONFIGURED_MODEL) {
      return {
        provider: 'hermes',
        sessionId: input.sessionId,
        supported: true,
        changed: false,
        model: null,
      };
    }

    return writeProviderSessionActiveModelChange('hermes', input);
  }

  private async readConfiguredModel(): Promise<string | null> {
    try {
      const content = await readFile(HERMES_CONFIG_PATH, 'utf8');
      return readOptionalString(readYamlPath(content, ['model', 'default']))
        ?? readOptionalString(readYamlPath(content, ['model']))
        ?? null;
    } catch {
      return null;
    }
  }
}
