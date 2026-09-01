import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';

import { sessionsDb } from '@/modules/database/index.js';
import type { IProviderModels } from '@/shared/interfaces.js';
import type {
  ProviderCurrentActiveModel,
  ProviderModelsDefinition,
} from '@/shared/types.js';
import {
  buildDefaultProviderCurrentActiveModel,
  getOpenCodeDatabasePath,
  readObjectRecord,
  readOptionalString,
} from '@/shared/utils.js';

/**
 * Curated OpenCode catalog shipped as immutable CloudCLI defaults.
 *
 * OpenCode routes by `<providerID>/<modelID>`, so this list mirrors the
 * providers `opencode models --verbose` reports: the OpenCode Zen gateway plus
 * the Anthropic and OpenAI providers OpenCode can address directly with the
 * user's own credentials.
 */
export const OPENCODE_PREDEFINED_MODELS: ProviderModelsDefinition = {
  OPTIONS: [
    { value: 'opencode/gpt-5.6-sol', label: 'GPT 5.6 Sol', description: 'OpenCode Zen' },
    { value: 'opencode/gpt-5.6-terra', label: 'GPT 5.6 Terra', description: 'OpenCode Zen' },
    { value: 'opencode/gpt-5.6-luna', label: 'GPT 5.6 Luna', description: 'OpenCode Zen' },
    { value: 'opencode/gpt-5.5', label: 'GPT 5.5', description: 'OpenCode Zen' },
    { value: 'opencode/gpt-5.5-pro', label: 'GPT 5.5 Pro', description: 'OpenCode Zen' },
    { value: 'opencode/gpt-5.4', label: 'GPT 5.4', description: 'OpenCode Zen' },
    { value: 'opencode/gpt-5.4-pro', label: 'GPT 5.4 Pro', description: 'OpenCode Zen' },
    { value: 'opencode/gpt-5.4-mini', label: 'GPT 5.4 Mini', description: 'OpenCode Zen' },
    { value: 'opencode/gpt-5.4-nano', label: 'GPT 5.4 Nano', description: 'OpenCode Zen' },
    { value: 'opencode/gpt-5.3-codex', label: 'GPT 5.3 Codex', description: 'OpenCode Zen' },
    { value: 'opencode/gpt-5.3-codex-spark', label: 'GPT 5.3 Codex Spark', description: 'OpenCode Zen' },
    { value: 'opencode/gpt-5.2', label: 'GPT 5.2', description: 'OpenCode Zen' },
    { value: 'opencode/gpt-5.1', label: 'GPT 5.1', description: 'OpenCode Zen' },
    { value: 'opencode/gpt-5', label: 'GPT 5', description: 'OpenCode Zen' },
    { value: 'opencode/gpt-5-nano', label: 'GPT 5 Nano', description: 'OpenCode Zen' },
    { value: 'opencode/claude-fable-5', label: 'Claude Fable 5', description: 'OpenCode Zen' },
    { value: 'opencode/claude-opus-5', label: 'Claude Opus 5', description: 'OpenCode Zen' },
    { value: 'opencode/claude-opus-4-8', label: 'Claude Opus 4.8', description: 'OpenCode Zen' },
    { value: 'opencode/claude-opus-4-7', label: 'Claude Opus 4.7', description: 'OpenCode Zen' },
    { value: 'opencode/claude-opus-4-6', label: 'Claude Opus 4.6', description: 'OpenCode Zen' },
    { value: 'opencode/claude-opus-4-5', label: 'Claude Opus 4.5', description: 'OpenCode Zen' },
    { value: 'opencode/claude-sonnet-5', label: 'Claude Sonnet 5', description: 'OpenCode Zen' },
    { value: 'opencode/claude-sonnet-4-6', label: 'Claude Sonnet 4.6', description: 'OpenCode Zen' },
    { value: 'opencode/claude-sonnet-4-5', label: 'Claude Sonnet 4.5', description: 'OpenCode Zen' },
    { value: 'opencode/claude-haiku-4-5', label: 'Claude Haiku 4.5', description: 'OpenCode Zen' },
    { value: 'opencode/gemini-3.6-flash', label: 'Gemini 3.6 Flash', description: 'OpenCode Zen' },
    { value: 'opencode/gemini-3.5-flash', label: 'Gemini 3.5 Flash', description: 'OpenCode Zen' },
    { value: 'opencode/gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash Lite', description: 'OpenCode Zen' },
    { value: 'opencode/gemini-3.1-pro', label: 'Gemini 3.1 Pro', description: 'OpenCode Zen' },
    { value: 'opencode/gemini-3-flash', label: 'Gemini 3 Flash', description: 'OpenCode Zen' },
    { value: 'opencode/grok-4.5', label: 'Grok 4.5', description: 'OpenCode Zen' },
    { value: 'opencode/grok-build-0.1', label: 'Grok Build 0.1', description: 'OpenCode Zen' },
    { value: 'opencode/qwen3.7-max', label: 'Qwen3.7 Max', description: 'OpenCode Zen' },
    { value: 'opencode/qwen3.7-plus', label: 'Qwen3.7 Plus', description: 'OpenCode Zen' },
    { value: 'opencode/qwen3.6-plus', label: 'Qwen3.6 Plus', description: 'OpenCode Zen' },
    { value: 'opencode/qwen3.5-plus', label: 'Qwen3.5 Plus', description: 'OpenCode Zen' },
    { value: 'opencode/deepseek-v4-pro', label: 'DeepSeek V4 Pro', description: 'OpenCode Zen' },
    { value: 'opencode/deepseek-v4-flash', label: 'DeepSeek V4 Flash', description: 'OpenCode Zen' },
    { value: 'opencode/minimax-m3', label: 'MiniMax M3', description: 'OpenCode Zen' },
    { value: 'opencode/minimax-m2.7', label: 'MiniMax M2.7', description: 'OpenCode Zen' },
    { value: 'opencode/minimax-m2.5', label: 'MiniMax M2.5', description: 'OpenCode Zen' },
    { value: 'opencode/glm-5.2', label: 'GLM 5.2', description: 'OpenCode Zen' },
    { value: 'opencode/glm-5.1', label: 'GLM 5.1', description: 'OpenCode Zen' },
    { value: 'opencode/kimi-k2.5', label: 'Kimi K2.5', description: 'OpenCode Zen' },
    { value: 'opencode/kimi-k2.6', label: 'Kimi K2.6', description: 'OpenCode Zen' },
    { value: 'opencode/kimi-k2.7-code', label: 'Kimi K2.7 Code', description: 'OpenCode Zen' },
    { value: 'opencode/kimi-k3', label: 'Kimi K3', description: 'OpenCode Zen' },
    { value: 'opencode/big-pickle', label: 'Big Pickle', description: 'OpenCode Zen · Free' },
    { value: 'opencode/mimo-v2.5-free', label: 'MiMo-V2.5 Free', description: 'OpenCode Zen · Free' },
    { value: 'opencode/laguna-s-2.1-free', label: 'Laguna S 2.1 Free', description: 'OpenCode Zen · Free' },
    { value: 'opencode/ling-3.0-flash-free', label: 'Ling-3.0-flash Free', description: 'OpenCode Zen · Free' },
    { value: 'opencode/north-mini-code-free', label: 'North Mini Code Free', description: 'OpenCode Zen · Free' },
    { value: 'opencode/nemotron-3-ultra-free', label: 'Nemotron 3 Ultra Free', description: 'OpenCode Zen · Free' },
    { value: 'opencode/deepseek-v4-flash-free', label: 'DeepSeek V4 Flash Free', description: 'OpenCode Zen · Free' },
    { value: 'anthropic/claude-opus-5', label: 'Claude Opus 5', description: 'Anthropic' },
    { value: 'anthropic/claude-opus-5-fast', label: 'Claude Opus 5 Fast', description: 'Anthropic' },
    { value: 'anthropic/claude-fable-5', label: 'Claude Fable 5', description: 'Anthropic' },
    { value: 'anthropic/claude-sonnet-5', label: 'Claude Sonnet 5', description: 'Anthropic' },
    { value: 'anthropic/claude-opus-4-8', label: 'Claude Opus 4.8', description: 'Anthropic' },
    { value: 'anthropic/claude-opus-4-8-fast', label: 'Claude Opus 4.8 Fast', description: 'Anthropic' },
    { value: 'anthropic/claude-opus-4-7', label: 'Claude Opus 4.7', description: 'Anthropic' },
    { value: 'anthropic/claude-opus-4-7-fast', label: 'Claude Opus 4.7 Fast', description: 'Anthropic' },
    { value: 'anthropic/claude-opus-4-6', label: 'Claude Opus 4.6', description: 'Anthropic' },
    { value: 'anthropic/claude-opus-4-6-fast', label: 'Claude Opus 4.6 Fast', description: 'Anthropic' },
    { value: 'anthropic/claude-opus-4-5', label: 'Claude Opus 4.5 (latest)', description: 'Anthropic' },
    { value: 'anthropic/claude-opus-4-5-20251101', label: 'Claude Opus 4.5', description: 'Anthropic' },
    { value: 'anthropic/claude-sonnet-4-6', label: 'Claude Sonnet 4.6', description: 'Anthropic' },
    { value: 'anthropic/claude-sonnet-4-5', label: 'Claude Sonnet 4.5 (latest)', description: 'Anthropic' },
    { value: 'anthropic/claude-sonnet-4-5-20250929', label: 'Claude Sonnet 4.5', description: 'Anthropic' },
    { value: 'anthropic/claude-haiku-4-5', label: 'Claude Haiku 4.5 (latest)', description: 'Anthropic' },
    { value: 'anthropic/claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', description: 'Anthropic' },
    { value: 'openai/gpt-5.6', label: 'GPT-5.6', description: 'OpenAI' },
    { value: 'openai/gpt-5.6-fast', label: 'GPT-5.6 Fast', description: 'OpenAI' },
    { value: 'openai/gpt-5.6-pro', label: 'GPT-5.6 Pro', description: 'OpenAI' },
    { value: 'openai/gpt-5.6-sol', label: 'GPT-5.6 Sol', description: 'OpenAI' },
    { value: 'openai/gpt-5.6-sol-fast', label: 'GPT-5.6 Sol Fast', description: 'OpenAI' },
    { value: 'openai/gpt-5.6-sol-pro', label: 'GPT-5.6 Sol Pro', description: 'OpenAI' },
    { value: 'openai/gpt-5.6-terra', label: 'GPT-5.6 Terra', description: 'OpenAI' },
    { value: 'openai/gpt-5.6-terra-fast', label: 'GPT-5.6 Terra Fast', description: 'OpenAI' },
    { value: 'openai/gpt-5.6-terra-pro', label: 'GPT-5.6 Terra Pro', description: 'OpenAI' },
    { value: 'openai/gpt-5.6-luna', label: 'GPT-5.6 Luna', description: 'OpenAI' },
    { value: 'openai/gpt-5.6-luna-fast', label: 'GPT-5.6 Luna Fast', description: 'OpenAI' },
    { value: 'openai/gpt-5.6-luna-pro', label: 'GPT-5.6 Luna Pro', description: 'OpenAI' },
    { value: 'openai/gpt-5.5', label: 'GPT-5.5', description: 'OpenAI' },
    { value: 'openai/gpt-5.5-fast', label: 'GPT-5.5 Fast', description: 'OpenAI' },
    { value: 'openai/gpt-5.4', label: 'GPT-5.4', description: 'OpenAI' },
    { value: 'openai/gpt-5.4-fast', label: 'GPT-5.4 Fast', description: 'OpenAI' },
    { value: 'openai/gpt-5.4-mini', label: 'GPT-5.4 mini', description: 'OpenAI' },
    { value: 'openai/gpt-5.4-mini-fast', label: 'GPT-5.4 mini Fast', description: 'OpenAI' },
    { value: 'openai/gpt-5.3-codex-spark', label: 'GPT-5.3 Codex Spark', description: 'OpenAI' },
  ],
  DEFAULT: 'opencode/gpt-5.6-terra',
};

/** Global OpenCode config files, in the order the CLI loads them. */
const OPENCODE_CONFIG_FILES = ['config.json', 'opencode.json', 'opencode.jsonc'];

/** Provider API keys OpenCode reads straight from the environment. */
const OPENCODE_ENV_PROVIDER_IDS: Record<string, string> = {
  OPENCODE_API_KEY: 'opencode',
  ANTHROPIC_API_KEY: 'anthropic',
  OPENAI_API_KEY: 'openai',
};

const readOpenCodeJsonFile = async (filePath: string): Promise<Record<string, unknown> | null> => {
  try {
    return readObjectRecord(JSON.parse(await readFile(filePath, 'utf8')));
  } catch {
    // Missing, unreadable, or comment-bearing (.jsonc) files simply contribute
    // nothing; the auth store is the authoritative source below.
    return null;
  }
};

/**
 * Lists the upstream providers this OpenCode install can actually route to.
 *
 * OpenCode resolves `<providerID>/<modelID>` against the providers the user has
 * connected, and rejects anything else outright - `Model
 * opencode/claude-sonnet-4-6 is not valid` is what a run gets for asking for an
 * OpenCode Zen model on a machine that only has an Anthropic key. The curated
 * catalog spans every provider OpenCode can address, so it has to be narrowed
 * to this machine's providers before it reaches the model picker.
 *
 * Returns null when nothing can be read, so the caller keeps the full catalog
 * rather than leaving the picker empty. Providers declared only in a
 * project-level `opencode.json` are not visible here; the null fallback and the
 * env-key sweep keep those installs on the full list.
 */
const readConnectedOpenCodeProviderIds = async (): Promise<Set<string> | null> => {
  const providerIds = new Set<string>();
  const configDir = path.join(os.homedir(), '.config', 'opencode');

  const auth = await readOpenCodeJsonFile(
    path.join(os.homedir(), '.local', 'share', 'opencode', 'auth.json'),
  );
  for (const [providerId, credential] of Object.entries(auth ?? {})) {
    if (readObjectRecord(credential)) {
      providerIds.add(providerId);
    }
  }

  for (const configFile of OPENCODE_CONFIG_FILES) {
    const config = await readOpenCodeJsonFile(path.join(configDir, configFile));
    for (const providerId of Object.keys(readObjectRecord(config?.provider) ?? {})) {
      providerIds.add(providerId);
    }
  }

  for (const [envKey, providerId] of Object.entries(OPENCODE_ENV_PROVIDER_IDS)) {
    if (readOptionalString(process.env[envKey])) {
      providerIds.add(providerId);
    }
  }

  return providerIds.size > 0 ? providerIds : null;
};

/**
 * Narrows the curated catalog to the providers OpenCode can route to.
 *
 * The default has to move with the list: leaving it on an OpenCode Zen model
 * would hand every new session a model the CLI refuses to run.
 */
const filterOpenCodeModelsByProvider = (
  definition: ProviderModelsDefinition,
  connectedProviderIds: Set<string> | null,
): ProviderModelsDefinition => {
  if (!connectedProviderIds) {
    return definition;
  }

  const options = definition.OPTIONS.filter(
    (option) => connectedProviderIds.has(option.value.split('/')[0]),
  );
  if (options.length === 0) {
    return definition;
  }

  return {
    ...definition,
    OPTIONS: options,
    DEFAULT: options.some((option) => option.value === definition.DEFAULT)
      ? definition.DEFAULT
      : options[0].value,
  };
};

const parseOpenCodeSessionModelValue = (rawModel: unknown): string | null => {
  if (typeof rawModel === 'string') {
    const trimmed = rawModel.trim();
    if (!trimmed) {
      return null;
    }

    try {
      return parseOpenCodeSessionModelValue(JSON.parse(trimmed));
    } catch {
      return trimmed;
    }
  }

  const record = readObjectRecord(rawModel);
  if (!record) {
    return null;
  }

  return readOptionalString(record.id)
    ?? readOptionalString(record.model)
    ?? readOptionalString(record.name)
    ?? readOptionalString(record.value)
    ?? null;
};

/** Provider registry model adapter for OpenCode predefined models and session metadata. */
export class OpenCodeProviderModels implements IProviderModels {
  async getSupportedModels(): Promise<ProviderModelsDefinition> {
    return filterOpenCodeModelsByProvider(
      OPENCODE_PREDEFINED_MODELS,
      await readConnectedOpenCodeProviderIds(),
    );
  }

  async getCurrentActiveModel(sessionId?: string): Promise<ProviderCurrentActiveModel> {
    if (!sessionId?.trim()) {
      return buildDefaultProviderCurrentActiveModel(await this.getSupportedModels());
    }

    // OpenCode's `session` table is keyed by its own session id, so the stable
    // app id has to be translated first; sessions discovered on disk store the
    // provider id in both columns and resolve to themselves.
    const providerSessionId = sessionsDb.getSessionById(sessionId)?.provider_session_id ?? sessionId;

    try {
      const dbPath = getOpenCodeDatabasePath();
      const db = new Database(dbPath, { readonly: true, fileMustExist: true });

      try {
        const row = db.prepare(`
          SELECT
            s.id AS sessionId,
            s.model AS model,
            s.agent AS agent,
            s.directory AS directory,
            s.time_updated AS timeUpdated,
            s.time_created AS timeCreated
          FROM session s
          WHERE s.id = ?
          ORDER BY COALESCE(s.time_updated, s.time_created, 0) DESC
          LIMIT 1
        `).get(providerSessionId) as {
          sessionId?: string;
          model?: unknown;
          agent?: string | null;
          directory?: string | null;
          timeUpdated?: number | null;
          timeCreated?: number | null;
        } | undefined;

        const model = parseOpenCodeSessionModelValue(row?.model);
        if (model) {
          return {
            model,
          };
        }
      } finally {
        db.close();
      }
    } catch {
      // Fall through to the curated default when OpenCode session lookup fails.
    }

    return buildDefaultProviderCurrentActiveModel(await this.getSupportedModels());
  }
}
