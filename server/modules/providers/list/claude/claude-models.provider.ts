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
      description: 'Use the Claude Code default model (currently Sonnet 5)',
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
      description: "Sonnet 5 · Best for everyday tasks · $3/$15 per Mtok",
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
      value: 'haiku',
      label: 'Haiku',
      description: 'Haiku 4.5 · Fastest for quick answers · $1/$5 per Mtok',
    },
  ],
  DEFAULT: 'default',
};

// Maps raw Anthropic API model ids (from JSONL transcripts, e.g. 'claude-sonnet-5')
// to the short CLI aliases used in CLAUDE_FALLBACK_MODELS.OPTIONS.
const CLAUDE_MODEL_FAMILY_PATTERNS: [alias: string, pattern: RegExp][] = [
  ['opus', /opus/i],
  ['sonnet', /sonnet/i],
  ['haiku', /haiku/i],
  ['fable', /fable/i],
];

const matchClaudeModelOptionFromRawId = (rawModel: string): ProviderModelOption | null => {
  const family = CLAUDE_MODEL_FAMILY_PATTERNS.find(([, pattern]) => pattern.test(rawModel));

  if (!family) {
    console.warn(
      `[claude-models] Unrecognized model id "${rawModel}" — no family pattern matched. `
      + 'Falling back to the catalog default; update CLAUDE_MODEL_FAMILY_PATTERNS '
      + 'in claude-models.provider.ts if a new Claude model was introduced.',
    );
    return null;
  }

  const [name] = family;

  return CLAUDE_FALLBACK_MODELS.OPTIONS.find((option) => option.value === name) ?? null;
};

export const findClaudeModelOption = (model: string | undefined | null): ProviderModelOption | null => {
  const normalizedModel = typeof model === 'string' ? model.trim() : '';
  if (!normalizedModel) {
    return null;
  }

  const exactMatch = CLAUDE_FALLBACK_MODELS.OPTIONS.find((option) => option.value === normalizedModel);
  if (exactMatch) {
    return exactMatch;
  }

  return matchClaudeModelOptionFromRawId(normalizedModel);
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
        return { model: findClaudeModelOption(model)?.value ?? CLAUDE_FALLBACK_MODELS.DEFAULT };
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
    return CLAUDE_FALLBACK_MODELS;
  }

  async getCurrentActiveModel(sessionId?: string): Promise<ProviderCurrentActiveModel> {
    if (!sessionId?.trim()) {
      return buildDefaultProviderCurrentActiveModel(await this.getSupportedModels());
    }

    try {
      const sessionRow = sessionsDb.getSessionById(sessionId);
      const jsonlPath = sessionRow?.jsonl_path;
      // JSONL events carry the provider-native session id, not the app-facing
      // `sessionId` used to look up the row, so compare against that instead.
      const providerSessionId = sessionRow?.provider_session_id || sessionId;
      const activeModel = jsonlPath
        ? await readClaudeSessionModelFromJsonl(providerSessionId, jsonlPath)
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
