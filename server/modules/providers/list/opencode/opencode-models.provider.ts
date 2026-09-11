import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// cross-spawn: drop-in spawn with Windows .cmd/PATHEXT resolution, matching
// the choice made in the OpenCode runtime adapter.
import crossSpawn from 'cross-spawn';
import Database from 'better-sqlite3';

import { sessionsDb } from '@/modules/database/index.js';
import type { IProviderModels } from '@/shared/interfaces.js';
import type {
  ProviderCurrentActiveModel,
  ProviderModelOption,
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
 * The live catalog comes from `opencode models --verbose`, so this list is now
 * metadata rather than the source of truth: it upgrades the bare ids the CLI
 * reports for the four built-in gateways (OpenCode Zen, OpenCode Go, and the
 * Anthropic and OpenAI providers OpenCode addresses with the user's own
 * credentials) into curated labels, groupings, and verified effort variants,
 * and it keeps the picker populated when the CLI cannot run at all.
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
    {
      value: 'opencode-go/grok-4.6',
      label: 'Grok 4.6',
      description: 'OpenCode Go',
      effort: {
        values: [{ value: 'low' }, { value: 'medium' }, { value: 'high' }, { value: 'xhigh' }],
      },
    },
    {
      value: 'opencode-go/glm-5.3-flash',
      label: 'GLM 5.3 Flash',
      description: 'OpenCode Go',
      effort: {
        values: [{ value: 'low' }, { value: 'high' }, { value: 'max' }],
      },
    },
    {
      value: 'opencode-go/glm-5.3',
      label: 'GLM 5.3',
      description: 'OpenCode Go',
      effort: {
        values: [{ value: 'low' }, { value: 'high' }, { value: 'max' }],
      },
    },
    {
      value: 'opencode-go/glm-5.2',
      label: 'GLM 5.2',
      description: 'OpenCode Go',
      effort: {
        values: [{ value: 'high' }, { value: 'max' }],
      },
    },
    { value: 'opencode-go/glm-5.1', label: 'GLM 5.1', description: 'OpenCode Go' },
    {
      value: 'opencode-go/gpt-5.6-luna',
      label: 'GPT 5.6 Luna',
      description: 'OpenCode Go',
      effort: {
        values: [
          { value: 'none' },
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
          { value: 'xhigh' },
          { value: 'max' },
        ],
      },
    },
    {
      value: 'opencode-go/kimi-k3',
      label: 'Kimi K3',
      description: 'OpenCode Go',
      effort: {
        values: [{ value: 'max' }],
      },
    },
    { value: 'opencode-go/kimi-k2.7-code', label: 'Kimi K2.7 Code', description: 'OpenCode Go' },
    { value: 'opencode-go/kimi-k2.6', label: 'Kimi K2.6', description: 'OpenCode Go' },
    {
      value: 'opencode-go/longcat-2.0',
      label: 'LongCat 2.0',
      description: 'OpenCode Go',
      effort: {
        values: [{ value: 'low' }, { value: 'medium' }, { value: 'high' }],
      },
    },
    { value: 'opencode-go/mimo-v2.5', label: 'MiMo V2.5', description: 'OpenCode Go' },
    { value: 'opencode-go/mimo-v2.5-pro', label: 'MiMo V2.5 Pro', description: 'OpenCode Go' },
    {
      value: 'opencode-go/minimax-m3',
      label: 'MiniMax M3',
      description: 'OpenCode Go',
      effort: {
        values: [{ value: 'none' }, { value: 'thinking' }],
      },
    },
    { value: 'opencode-go/minimax-m2.7', label: 'MiniMax M2.7', description: 'OpenCode Go' },
    {
      value: 'opencode-go/muse-spark-1.3-contributor',
      label: 'Muse Spark 1.3 Contributor',
      description: 'OpenCode Go',
      effort: {
        values: [
          { value: 'minimal' },
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
          { value: 'xhigh' },
        ],
      },
    },
    {
      value: 'opencode-go/muse-spark-1.2-contributor',
      label: 'Muse Spark 1.2 Contributor',
      description: 'OpenCode Go',
      effort: {
        values: [
          { value: 'minimal' },
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
          { value: 'xhigh' },
        ],
      },
    },
    {
      value: 'opencode-go/qwen3.8-max',
      label: 'Qwen3.8 Max',
      description: 'OpenCode Go',
      effort: {
        values: [{ value: 'low' }, { value: 'medium' }, { value: 'xhigh' }],
      },
    },
    {
      value: 'opencode-go/qwen3.8-flash',
      label: 'Qwen3.8 Flash',
      description: 'OpenCode Go',
      effort: {
        values: [{ value: 'low' }, { value: 'medium' }, { value: 'xhigh' }],
      },
    },
    { value: 'opencode-go/qwen3.7-max', label: 'Qwen3.7 Max', description: 'OpenCode Go' },
    { value: 'opencode-go/qwen3.7-plus', label: 'Qwen3.7 Plus', description: 'OpenCode Go' },
    { value: 'opencode-go/qwen3.6-plus', label: 'Qwen3.6 Plus', description: 'OpenCode Go' },
    {
      value: 'opencode-go/deepseek-v4-pro',
      label: 'DeepSeek V4 Pro',
      description: 'OpenCode Go',
      effort: {
        values: [{ value: 'high' }, { value: 'max' }],
      },
    },
    {
      value: 'opencode-go/deepseek-v4-flash',
      label: 'DeepSeek V4 Flash',
      description: 'OpenCode Go',
      effort: {
        values: [{ value: 'low' }, { value: 'high' }, { value: 'max' }],
      },
    },
    {
      value: 'opencode-go/deepseek-v4-flash-vision-exp',
      label: 'DeepSeek V4 Flash Vision Exp',
      description: 'OpenCode Go',
      effort: {
        values: [{ value: 'low' }, { value: 'high' }, { value: 'max' }],
      },
    },
    {
      value: 'opencode-go/hy4-preview',
      label: 'Hy4 Preview',
      description: 'OpenCode Go',
      effort: {
        values: [{ value: 'none' }, { value: 'high' }],
      },
    },
    {
      value: 'opencode-go/hy3',
      label: 'Hy3',
      description: 'OpenCode Go',
      effort: {
        values: [{ value: 'none' }, { value: 'low' }, { value: 'high' }],
      },
    },
    {
      value: 'opencode-go/omen-alpha',
      label: 'Omen Alpha',
      description: 'OpenCode Go',
      effort: {
        values: [{ value: 'low' }, { value: 'high' }],
      },
    },
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

/** How long a successful `opencode models --verbose` answer stays fresh. */
const LIVE_CATALOG_TTL_MS = 60_000;

/** Kill bound for one discovery invocation; the CLI answers in ~2s normally. */
const OPENCODE_MODELS_CLI_TIMEOUT_MS = 15_000;

const readOpenCodeJsonFile = async (filePath: string): Promise<Record<string, unknown> | null> => {
  try {
    return readObjectRecord(JSON.parse(await readFile(filePath, 'utf8')));
  } catch {
    // Missing, unreadable, or comment-bearing (.jsonc) files simply contribute
    // nothing; the CLI and the auth store are the authoritative sources.
    return null;
  }
};

/**
 * Lists the upstream providers this OpenCode install can actually route to.
 *
 * Only consulted as a fallback when the CLI is unavailable. OpenCode resolves
 * `<providerID>/<modelID>` against the providers the user has connected, and
 * rejects anything else outright - `Model
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

/** One `opencode models --verbose` record, narrowed to the picker's fields. */
type OpenCodeCliModel = {
  id: string;
  providerId: string;
  name: string | null;
  variants: string[] | null;
};

/**
 * Maps CLI variant names onto the picker's effort block.
 *
 * The CLI exposes variants by name only; the runtime forwards the chosen value
 * as `--variant`, so the names pass through untouched.
 */
const toOpenCodeEffort = (
  variantKeys: string[],
): ProviderModelOption['effort'] => ({
  values: variantKeys.map((value) => ({ value })),
});

const countJsonBraces = (text: string): number => {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (const char of text) {
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
    } else if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
    }
  }
  return depth;
};

const safeJsonParse = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const parseOpenCodeCliModels = (stdout: string): OpenCodeCliModel[] => {
  // `--verbose` prints `providerID/modelID` lines interleaved with one pretty-
  // printed JSON object per model. The objects are the payload; the bare lines
  // only fill in the provider id when an object is missing one.
  const lines = stdout.split(/\r?\n/);
  const models: OpenCodeCliModel[] = [];
  const seen = new Set<string>();
  let pendingLine: string | null = null;
  let index = 0;

  while (index < lines.length) {
    const line = lines[index].trim();
    index += 1;
    if (!line) {
      continue;
    }

    if (!line.startsWith('{')) {
      if (line.includes('/')) {
        pendingLine = line;
      }
      continue;
    }

    // Pretty-printed objects span many lines; buffer until the braces balance.
    let json = line;
    while (index < lines.length && countJsonBraces(json) > 0) {
      json += `\n${lines[index]}`;
      index += 1;
    }

    const record = readObjectRecord(safeJsonParse(json));
    if (!record) {
      continue;
    }

    const modelId = readOptionalString(record.id);
    const providerId = readOptionalString(record.providerID)
      ?? readOptionalString(record.providerId)
      ?? pendingLine?.split('/')[0]
      ?? null;
    if (!modelId || !providerId) {
      continue;
    }

    // Retired catalog entries still print; offering them would hand the picker
    // a model the CLI refuses to run.
    const status = readOptionalString(record.status);
    if (status && status !== 'active') {
      continue;
    }

    const value = `${providerId}/${modelId}`;
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);

    models.push({
      id: value,
      providerId,
      name: readOptionalString(record.name) ?? null,
      variants: Object.keys(readObjectRecord(record.variants) ?? {}),
    });
  }

  return models;
};

/**
 * Runs `opencode models --verbose` and parses its answer.
 *
 * Returns null when the CLI cannot produce a catalog - not installed, errored,
 * timed out, or unparseable - so the caller keeps the curated fallback rather
 * than leaving the picker empty. This is the only path that sees providers the
 * user defined themselves, because it asks the same resolver the run command
 * uses instead of re-deriving connectivity from config files.
 */
const readOpenCodeCliModels = async (
  runModelsCli: () => Promise<string | null>,
): Promise<OpenCodeCliModel[] | null> => {
  const raw = await runModelsCli();
  if (raw === null) {
    return null;
  }

  const models = parseOpenCodeCliModels(raw);
  return models.length > 0 ? models : null;
};

const runOpenCodeModelsCli = async (): Promise<string | null> =>
  new Promise((resolve) => {
    let child: ReturnType<typeof crossSpawn>;
    try {
      child = crossSpawn('opencode', ['models', '--verbose'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
      });
    } catch (error) {
      console.warn('[OpenCode] `opencode models --verbose` failed to start:', error);
      resolve(null);
      return;
    }

    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (value: string | null, reason?: string) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (value === null) {
        console.warn(
          '[OpenCode] `opencode models --verbose` unusable (%s). stderr: %s',
          reason ?? 'unknown',
          stderr.trim().slice(0, 400) || '(empty)',
        );
      }
      resolve(value);
    };

    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // A dead child is exactly what the timeout wants anyway.
      }
      finish(null, 'timeout');
    }, OPENCODE_MODELS_CLI_TIMEOUT_MS);

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      console.warn('[OpenCode] `opencode models --verbose` spawn error:', error);
      finish(null, 'spawn-error');
    });
    child.on('close', (code) => {
      finish(code === 0 && stdout.trim() ? stdout : null, `exit=${code} stdout=${stdout.length}B`);
    });
  });

/**
 * Builds the picker catalog from the live CLI answer, upgraded by curated rows.
 *
 * Curated options come first so the grouped Zen/Go/Anthropic/OpenAI entries keep
 * their labels, descriptions, and effort metadata; the user's own providers then
 * append as-is. `description` carries the provider id, which is what makes a
 * `bit-openai/gpt-5.6-sol` entry distinguishable from the curated `openai/` one.
 */
const buildCatalogFromCli = (
  cliModels: OpenCodeCliModel[],
): ProviderModelsDefinition => {
  const cliById = new Map(cliModels.map((model) => [model.id, model]));
  const options: ProviderModelOption[] = [];
  const seen = new Set<string>();

  // Curated rows first, in curated order, but only for models this install
  // actually has; that keeps the grouped Zen/Go/Anthropic/OpenAI entries on
  // their labels, descriptions, and verified effort blocks.
  for (const curated of OPENCODE_PREDEFINED_MODELS.OPTIONS) {
    if (cliById.has(curated.value) && !seen.has(curated.value)) {
      seen.add(curated.value);
      options.push(curated);
    }
  }

  // Everything the CLI reports that the curated catalog does not know - the
  // user's own providers above all - appends as-is. `description` carries the
  // provider id, which is what makes a `bit-openai/gpt-5.6-sol` entry
  // distinguishable from the curated `openai/` one.
  for (const model of cliModels) {
    if (seen.has(model.id)) {
      continue;
    }
    seen.add(model.id);

    const effort = model.variants && model.variants.length > 0
      ? toOpenCodeEffort(model.variants)
      : undefined;
    options.push({
      value: model.id,
      label: model.name ?? model.id.split('/').slice(1).join('/'),
      description: model.providerId,
      ...(effort ? { effort } : {}),
    });
  }

  if (options.length === 0) {
    return OPENCODE_PREDEFINED_MODELS;
  }

  return {
    OPTIONS: options,
    DEFAULT: options.some((option) => option.value === OPENCODE_PREDEFINED_MODELS.DEFAULT)
      ? OPENCODE_PREDEFINED_MODELS.DEFAULT
      : options[0].value,
  };
};

/**
 * Narrows the curated catalog to the providers OpenCode can route to.
 *
 * Fallback path only - used when the CLI is unavailable. The default has to move
 * with the list: leaving it on an OpenCode Zen model would hand every new
 * session a model the CLI refuses to run.
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

/** Test seam: replaces the CLI invocation with a fixture-backed reader. */
export type OpenCodeProviderModelsDependencies = {
  runModelsCli?: () => Promise<string | null>;
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
  private readonly runModelsCli: () => Promise<string | null>;
  private liveCatalog: Promise<ProviderModelsDefinition | null> | null = null;
  private liveCatalogExpiresAt = 0;

  constructor(dependencies: OpenCodeProviderModelsDependencies = {}) {
    this.runModelsCli = dependencies.runModelsCli ?? runOpenCodeModelsCli;
  }

  /**
   * Reports the picker catalog: live CLI answer first, curated fallback second.
   *
   * The CLI is the only source that sees user-defined providers, but it costs
   * ~2s, so a successful answer is cached briefly and concurrent callers share
   * one in-flight run (the picker, the active-model lookup, and effort
   * validation all resolve the catalog within the same page load). A failed run
   * is not cached; the next caller retries rather than waiting out the TTL on a
   * null answer.
   */
  async getSupportedModels(): Promise<ProviderModelsDefinition> {
    if (!this.liveCatalog || Date.now() >= this.liveCatalogExpiresAt) {
      const run = (async (): Promise<ProviderModelsDefinition | null> => {
        const cliModels = await readOpenCodeCliModels(this.runModelsCli);
        return cliModels ? buildCatalogFromCli(cliModels) : null;
      })();
      this.liveCatalog = run;
      this.liveCatalogExpiresAt = Date.now() + LIVE_CATALOG_TTL_MS;
      void run.catch(() => {
        if (this.liveCatalog === run) {
          this.liveCatalog = null;
          this.liveCatalogExpiresAt = 0;
        }
      });
    }

    const live = await this.liveCatalog.catch(() => null);
    if (live) {
      return live;
    }

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
