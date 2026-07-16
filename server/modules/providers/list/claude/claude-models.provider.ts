import { readFile } from 'node:fs/promises';

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

export const CLAUDE_FALLBACK_MODELS: ProviderModelsDefinition = {
  OPTIONS: [
    {
      value: 'default',
      label: 'Default (recommended)',
      description: 'Use the Claude Code default model (currently Sonnet 4.6)',
      effort: {
        default: 'high',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
          { value: 'max' },
        ],
      },
    },
    {
      value: 'fable',
      label: 'Fable',
      description: 'Fable 5 · Most capable for your hardest and longest-running tasks · Uses your limits ~2× faster than Opus',
      effort: {
        default: 'high',
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
      value: "sonnet",
      label: "Sonnet",
      description: "Sonnet 4.6 · Best for everyday tasks · $3/$15 per Mtok",
      effort: {
        default: 'high',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
          { value: 'max' },
        ],
      },
    },
    {
      value: 'sonnet[1m]',
      label: 'Sonnet (1M context)',
      description: 'Sonnet 4.6 for long sessions · $3/$15 per Mtok',
      effort: {
        default: 'high',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
          { value: 'max' },
        ],
      },
    },
    {
      value: 'opus',
      label: 'Opus',
      description: 'Opus 4.8 · Best for everyday, complex tasks · ~2× usage vs Sonnet',
      effort: {
        default: 'high',
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
      value: 'opus[1m]',
      label: 'Opus 4.8 (1M context)',
      description: 'Opus 4.8 with 1M context · Most capable for complex work · $5/$25 per Mtok',
      effort: {
        default: 'high',
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
      value: 'haiku',
      label: 'Haiku',
      description: 'Haiku 4.5 · Fastest for quick answers · $1/$5 per Mtok',
    },
  ],
  DEFAULT: 'default',
};

export const findClaudeModelOption = (model: string | undefined | null): ProviderModelOption | null => {
  const normalizedModel = typeof model === 'string' ? model.trim() : '';
  if (!normalizedModel) {
    return null;
  }

  return CLAUDE_FALLBACK_MODELS.OPTIONS.find((option) => option.value === normalizedModel) ?? null;
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

// Claude tags system-generated placeholder turns (e.g. an interrupted or
// errored response) with sentinel model values like `<synthetic>`. These are
// never a real model selection, so they must not mask the actual active model
// recorded earlier in the transcript.
const isPlaceholderClaudeModel = (model: string): boolean => model.startsWith('<');

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
  if (directModel && !isPlaceholderClaudeModel(directModel)) {
    return directModel;
  }

  const messageModel = event.message?.model?.trim();
  return messageModel && !isPlaceholderClaudeModel(messageModel) ? messageModel : null;
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

// Resolves the model recorded for a session to a catalog option value the model
// picker can highlight. Explicit selections (picker override, `/model` command)
// are already option values and pass through unchanged. A normal turn only
// records the raw provider-native id (e.g. `claude-opus-4-8`), so it is mapped
// back to the catalog option whose value names the model family.
//
// Families are derived from the catalog itself rather than hard-coded, so a
// newly released model (e.g. a future `claude-<family>-*`) is matched as soon as
// it has a catalog entry — no change is needed here. Unknown values are returned
// as-is so callers can decide how to fall back.
const resolveClaudeActiveOptionValue = (
  model: string,
  models: ProviderModelsDefinition,
): string => {
  const normalized = model.trim();
  if (models.OPTIONS.some((option) => option.value === normalized)) {
    return normalized;
  }

  const lowered = normalized.toLowerCase();
  const familyMatch = models.OPTIONS
    .filter((option) => {
      const value = option.value.toLowerCase();
      // Only simple family aliases (e.g. `opus`) can name a raw model id; skip
      // decorated values like `opus[1m]` and non-model aliases like `default`.
      return /^[a-z][a-z0-9.]*$/.test(value)
        && (lowered === `claude-${value}` || lowered.startsWith(`claude-${value}-`));
    })
    // Prefer the most specific family when several share a prefix.
    .sort((first, second) => second.value.length - first.value.length)[0];

  return familyMatch?.value ?? normalized;
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
    return CLAUDE_FALLBACK_MODELS;
  }

  async getCurrentActiveModel(sessionId?: string): Promise<ProviderCurrentActiveModel> {
    const models = await this.getSupportedModels();
    if (!sessionId?.trim()) {
      return buildDefaultProviderCurrentActiveModel(models);
    }

    try {
      const session = sessionsDb.getSessionById(sessionId);
      const jsonlPath = session?.jsonl_path;
      // The transcript records events under the provider-native session id, which
      // differs from the app-facing session id the frontend passes here. Match on
      // the provider id so the lookup is not filtered out; fall back to the given
      // id for rows created before that mapping was stored.
      const transcriptSessionId = session?.provider_session_id ?? sessionId;
      const activeModel = jsonlPath
        ? await readClaudeSessionModelFromJsonl(transcriptSessionId, jsonlPath)
        : null;
      if (activeModel?.model) {
        return { model: resolveClaudeActiveOptionValue(activeModel.model, models) };
      }
    } catch {
      // Fall through to the provider default when the session-backed lookup fails.
    }

    return buildDefaultProviderCurrentActiveModel(models);
  }

  async changeActiveModel(
    input: ProviderChangeActiveModelInput,
  ): Promise<ProviderSessionActiveModelChange> {
    return writeProviderSessionActiveModelChange('claude', input);
  }
}
