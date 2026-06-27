import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { sessionsDb } from '@/modules/database/index.js';
import type { IProviderModels } from '@/shared/interfaces.js';
import type {
  ProviderChangeActiveModelInput,
  ProviderCurrentActiveModel,
  ProviderModelOption,
  ProviderModelsDefinition,
  ProviderSessionActiveModelChange,
} from '@/shared/types.js';
import {
  buildDefaultProviderCurrentActiveModel,
  writeProviderSessionActiveModelChange,
} from '@/shared/utils.js';

// cc-switch integration is opt-in via env so installs without cc-switch keep the
// static fallback list. CLAUDE_CC_SWITCH_DB_PATH overrides the default DB location.
const isCcSwitchModelsEnabled = (): boolean => {
  const value = process.env.CLAUDE_CC_SWITCH_MODELS_ENABLED;
  return value === 'true' || value === '1';
};

const getCcSwitchDbPath = (): string => process.env.CLAUDE_CC_SWITCH_DB_PATH?.trim()
  || path.join(os.homedir(), '.cc-switch', 'cc-switch.db');

// claude CLI accepts tier aliases, not full model IDs. cc-switch's proxy rewrites
// each alias to a real model ID via the ANTHROPIC_DEFAULT_<TIER>_MODEL env vars on
// the current provider. The OPTIONS value must stay a CLI alias so the SDK passes
// it through unchanged; the label surfaces the real model name from cc-switch.
const CLAUDE_MODEL_TIERS = [
  { alias: 'opus', envKey: 'ANTHROPIC_DEFAULT_OPUS_MODEL_NAME', label: 'Opus' },
  { alias: 'sonnet', envKey: 'ANTHROPIC_DEFAULT_SONNET_MODEL_NAME', label: 'Sonnet' },
  { alias: 'haiku', envKey: 'ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME', label: 'Haiku' },
  { alias: 'fable', envKey: 'ANTHROPIC_DEFAULT_FABLE_MODEL_NAME', label: 'Fable' },
] as const;

type CcSwitchProviderSettings = {
  env?: Record<string, string>;
};

type CcSwitchProviderRow = {
  settings_config: string;
};

const readClaudeAliasMapFromCcSwitch = async (
  dbPath = getCcSwitchDbPath(),
): Promise<Record<string, string> | null> => {
  const { default: Database } = await import('better-sqlite3');
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });

  try {
    const row = db.prepare(
      "SELECT settings_config FROM providers WHERE app_type = 'claude' AND is_current = 1 LIMIT 1",
    ).get() as CcSwitchProviderRow | undefined;

    if (!row?.settings_config) {
      return null;
    }

    const settings = JSON.parse(row.settings_config) as CcSwitchProviderSettings;
    return settings.env ?? {};
  } finally {
    db.close();
  }
};

const buildClaudeModelsFromCcSwitch = (
  env: Record<string, string>,
): ProviderModelsDefinition | null => {
  const options: ProviderModelOption[] = CLAUDE_MODEL_TIERS
    .map((tier): ProviderModelOption | null => {
      const modelName = env[tier.envKey]?.trim();
      if (!modelName) {
        return null;
      }

      return {
        value: tier.alias,
        label: `${tier.label} · ${modelName}`,
      };
    })
    .filter((option): option is ProviderModelOption => option !== null);

  if (options.length === 0) {
    return null;
  }

  // "default" is the CLI's recommended alias — it follows the provider's own
  // model preference rather than pinning a tier. Keep it first.
  const defaultOption: ProviderModelOption = {
    value: 'default',
    label: 'Default (recommended)',
  };

  return {
    OPTIONS: [defaultOption, ...options],
    DEFAULT: 'default',
  };
};

const resolveClaudeModelsFromCcSwitch = async (): Promise<ProviderModelsDefinition | null> => {
  if (!isCcSwitchModelsEnabled()) {
    return null;
  }

  try {
    const env = await readClaudeAliasMapFromCcSwitch();
    return env ? buildClaudeModelsFromCcSwitch(env) : null;
  } catch {
    // DB missing, locked, malformed, or better-sqlite3 unavailable — fall back.
    return null;
  }
};

export const CLAUDE_FALLBACK_MODELS: ProviderModelsDefinition = {
  OPTIONS: [
    {
      value: 'default',
      label: 'Default (recommended)',
      description: 'Use the default model (currently Opus 4.8 (1M context)) · $5/$25 per Mtok',
    },
    {
      value: 'fable',
      label: 'Fable',
      description: 'Fable 5 · Most capable for your hardest and longest-running tasks · Uses your limits ~2× faster than Opus',
    },
    {
      value: "sonnet",
      label: "Sonnet",
      description: "Sonnet 4.6 · Best for everyday tasks · $3/$15 per Mtok",
    },
    {
      value: 'sonnet[1m]',
      label: 'Sonnet (1M context)',
      description: 'Sonnet 4.6 for long sessions · $3/$15 per Mtok',
    },
    {
      value: 'opus[1m]',
      label: 'Opus 4.8 (1M context)',
      description: 'Opus 4.8 with 1M context · Most capable for complex work · $5/$25 per Mtok',
    },
    {
      value: 'haiku',
      label: 'Haiku',
      description: 'Haiku 4.5 · Fastest for quick answers · $1/$5 per Mtok',
    },
  ],
  DEFAULT: 'default',
};
type ClaudeInitEvent = {
  sessionId?: string;
  session_id?: string;
  type?: string;
  subtype?: string;
  model?: string;
  message?: {
    content?: unknown;
    model?: string;
  };
};

const ANSI_PATTERN = new RegExp(
  '[\\u001B\\u009B][[\\]()#;?]*(?:'
  + '(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]'
  + '|(?:[\\dA-PR-TZcf-ntqry=><~]))',
  'g',
);

const extractClaudeEventModel = (event: ClaudeInitEvent, sessionId: string): string | null => {
  const eventSessionId = event.sessionId ?? event.session_id;
  if (eventSessionId && eventSessionId !== sessionId) {
    return null;
  }

  const contentModel = extractClaudeModelFromMessageContent(event.message?.content);
  if (contentModel) {
    return contentModel;
  }

  const directModel = event.model?.trim();
  if (directModel) {
    return directModel;
  }

  const messageModel = event.message?.model?.trim();
  return messageModel || null;
};

const stripAnsi = (value: string): string => value.replace(ANSI_PATTERN, '');

const extractTaggedContent = (content: string, tagName: string): string | null => {
  const escapedTagName = tagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`<${escapedTagName}>([\\s\\S]*?)<\\/${escapedTagName}>`).exec(content);
  return match ? match[1] : null;
};

const extractClaudeModelFromTextContent = (content: string): string | null => {
  const localCommandStdout = extractTaggedContent(content, 'local-command-stdout');
  if (localCommandStdout !== null) {
    const cleanedStdout = stripAnsi(localCommandStdout).replace(/\s+/g, ' ').trim();
    const changedModel = /(?:set|changed|switched)\s+model\s+to\s+(.+?)\.?$/i.exec(cleanedStdout);
    if (changedModel?.[1]?.trim()) {
      return changedModel[1].trim();
    }
  }

  const modelTag = extractTaggedContent(content, 'model')?.trim();
  return modelTag || null;
};

const extractClaudeModelFromMessageContent = (content: unknown): string | null => {
  if (typeof content === 'string') {
    return extractClaudeModelFromTextContent(content);
  }

  if (!Array.isArray(content)) {
    return null;
  }

  for (const part of content) {
    if (!part || typeof part !== 'object' || !('text' in part) || typeof part.text !== 'string') {
      continue;
    }

    const model = extractClaudeModelFromTextContent(part.text);
    if (model) {
      return model;
    }
  }

  return null;
};

const readClaudeSessionModelFromJsonl = async (
  sessionId: string,
  jsonlPath: string,
): Promise<ProviderCurrentActiveModel | null> => {
  const content = await readFile(jsonlPath, 'utf8');
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const event = JSON.parse(lines[index]) as ClaudeInitEvent;
      const model = extractClaudeEventModel(event, sessionId);
      if (model) {
        return { model };
      }
    } catch {
      // Skip malformed JSONL lines that can happen during concurrent writes.
    }
  }

  return null;
};

export class ClaudeProviderModels implements IProviderModels {
  async getSupportedModels(): Promise<ProviderModelsDefinition> {
    // claude creates a new jsonl file as a separate session for this request.
    // As a result, it lists the workspace where this is invoked when it shouldn't.
    //
    // Disabled for now:
    // const queryInstance = query({
    //   prompt: 'Get supported models',
    //   options: buildClaudeQueryOptions(),
    // });
    // const supportedModels = await queryInstance.supportedModels();
    // queryInstance.close();
    // return buildClaudeModelsDefinition(supportedModels);

    // Source the model list from cc-switch's current claude provider when available:
    // it carries the alias→real-model mapping the proxy actually honors. Fall back to
    // the static list when cc-switch is absent or unconfigured.
    const ccSwitchModels = await resolveClaudeModelsFromCcSwitch();
    return ccSwitchModels ?? CLAUDE_FALLBACK_MODELS;
  }

  async getCurrentActiveModel(sessionId?: string): Promise<ProviderCurrentActiveModel> {
    if (!sessionId?.trim()) {
      return buildDefaultProviderCurrentActiveModel(await this.getSupportedModels());
    }

    try {
      const jsonlPath = sessionsDb.getSessionById(sessionId)?.jsonl_path;
      const activeModel = jsonlPath
        ? await readClaudeSessionModelFromJsonl(sessionId, jsonlPath)
        : null;
      if (activeModel?.model) {
        return activeModel;
      }
    } catch {
      // Fall through to the provider default when the session-backed lookup fails.
    }

    return buildDefaultProviderCurrentActiveModel(await this.getSupportedModels());
  }

  async changeActiveModel(
    input: ProviderChangeActiveModelInput,
  ): Promise<ProviderSessionActiveModelChange> {
    return writeProviderSessionActiveModelChange('claude', input);
  }
}
