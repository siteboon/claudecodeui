import { readFile } from 'node:fs/promises';

import { sessionsDb } from '@/modules/database/index.js';
import type { IProviderModels } from '@/shared/interfaces.js';
import type {
  ProviderCurrentActiveModel,
  ProviderModelOption,
  ProviderModelsDefinition,
} from '@/shared/types.js';
import {
  buildDefaultProviderCurrentActiveModel,
  isPlaceholderProviderModel,
  stripAnsiSequences,
} from '@/shared/utils.js';

/**
 * Ultracode is not one of the SDK's reasoning-effort levels. Selecting it runs the turn at
 * `xhigh` effort with standing dynamic-workflow orchestration, which the Claude runtime
 * translates into the session-scoped `ultracode` setting. It is therefore only offered on
 * models this catalog already marks as xhigh-capable.
 */
export const CLAUDE_ULTRACODE_EFFORT = 'ultracode';

const ULTRACODE_EFFORT_OPTION = {
  value: CLAUDE_ULTRACODE_EFFORT,
  description: 'Highest effort plus standing workflow orchestration.',
};

const EFFORT_LEVELS_WITH_XHIGH = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
// Opus 4.6 and Sonnet 4.6 predate the xhigh level; Claude Code rejects it for them.
const EFFORT_LEVELS_WITHOUT_XHIGH = ['low', 'medium', 'high', 'max'] as const;

/**
 * Builds the effort control for one pinned model version. The levels and default mirror the
 * ones Claude Code's own model picker declares for that version, so an unchanged control sends
 * the effort Claude Code would have used anyway. Ultracode is appended when asked for: Claude
 * Code honours it only on xhigh-capable models. Arrays are built per call so options never
 * share them.
 */
const buildPinnedModelEffort = (
  defaultEffort: string,
  levels: readonly string[],
  { ultracode }: { ultracode: boolean },
): NonNullable<ProviderModelOption['effort']> => ({
  default: defaultEffort,
  values: [
    ...levels.map((value) => ({ value })),
    ...(ultracode ? [ULTRACODE_EFFORT_OPTION] : []),
  ],
});

/**
 * Exact model versions, listed after the aliases above. An alias such as `opus` follows
 * whichever release is newest; these stay on one release, which is what a user picks them for.
 * The set matches the versions Claude Code's own model picker offers.
 */
const CLAUDE_PINNED_MODEL_OPTIONS: ProviderModelOption[] = [
  {
    value: 'claude-fable-5-2',
    label: 'Fable 5.2',
    description: 'Pinned to Fable 5.2, the current Fable release.',
    effort: buildPinnedModelEffort('medium', EFFORT_LEVELS_WITH_XHIGH, { ultracode: true }),
  },
  {
    value: 'claude-fable-5-1',
    label: 'Fable 5.1',
    description: 'Pinned to Fable 5.1.',
    effort: buildPinnedModelEffort('high', EFFORT_LEVELS_WITH_XHIGH, { ultracode: true }),
  },
  {
    value: 'claude-fable-5',
    label: 'Fable 5',
    description: 'Pinned to Fable 5.',
    effort: buildPinnedModelEffort('high', EFFORT_LEVELS_WITH_XHIGH, { ultracode: true }),
  },
  {
    value: 'claude-opus-5-5',
    label: 'Opus 5.5',
    description: 'Pinned to Opus 5.5, the current Opus release.',
    effort: buildPinnedModelEffort('medium', EFFORT_LEVELS_WITH_XHIGH, { ultracode: true }),
  },
  {
    value: 'claude-opus-5',
    label: 'Opus 5',
    description: 'Pinned to Opus 5.',
    effort: buildPinnedModelEffort('high', EFFORT_LEVELS_WITH_XHIGH, { ultracode: true }),
  },
  {
    value: 'claude-opus-4-8',
    label: 'Opus 4.8',
    description: 'Pinned to Opus 4.8.',
    effort: buildPinnedModelEffort('high', EFFORT_LEVELS_WITH_XHIGH, { ultracode: true }),
  },
  {
    value: 'claude-opus-4-7',
    label: 'Opus 4.7',
    description: 'Pinned to Opus 4.7.',
    effort: buildPinnedModelEffort('xhigh', EFFORT_LEVELS_WITH_XHIGH, { ultracode: true }),
  },
  {
    value: 'claude-opus-4-6',
    label: 'Opus 4.6',
    description: 'Pinned to Opus 4.6.',
    effort: buildPinnedModelEffort('high', EFFORT_LEVELS_WITHOUT_XHIGH, { ultracode: false }),
  },
  {
    value: 'claude-sonnet-5-5',
    label: 'Sonnet 5.5',
    description: 'Pinned to Sonnet 5.5, the current Sonnet release.',
    effort: buildPinnedModelEffort('medium', EFFORT_LEVELS_WITH_XHIGH, { ultracode: true }),
  },
  {
    value: 'claude-sonnet-5',
    label: 'Sonnet 5',
    description: 'Pinned to Sonnet 5.',
    effort: buildPinnedModelEffort('high', EFFORT_LEVELS_WITH_XHIGH, { ultracode: true }),
  },
  {
    value: 'claude-sonnet-4-6',
    label: 'Sonnet 4.6',
    description: 'Pinned to Sonnet 4.6.',
    effort: buildPinnedModelEffort('high', EFFORT_LEVELS_WITHOUT_XHIGH, { ultracode: false }),
  },
  {
    value: 'claude-haiku-5-5',
    label: 'Haiku 5.5',
    description: 'Pinned to Haiku 5.5, the current Haiku release.',
    // Ultracode is left out for the same reason as on the `haiku` alias.
    effort: buildPinnedModelEffort('medium', EFFORT_LEVELS_WITH_XHIGH, { ultracode: false }),
  },
  {
    // Claude Code's picker sends the dated id for this release, so the catalog does too.
    value: 'claude-haiku-4-5-20251001',
    label: 'Haiku 4.5',
    description: 'Pinned to Haiku 4.5. Has no effort control.',
  },
];

export const CLAUDE_PREDEFINED_MODELS: ProviderModelsDefinition = {
  OPTIONS: [
    {
      value: 'default',
      label: 'Default (recommended)',
      description: 'Use the recommended model for your Claude account and deployment.',
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
      value: 'best',
      label: 'Best available',
      description: 'Use Fable when available, otherwise the latest Opus model.',
      effort: {
        default: 'high',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
          { value: 'xhigh' },
          { value: 'max' },
          ULTRACODE_EFFORT_OPTION,
        ],
      },
    },
    {
      value: 'fable',
      label: 'Fable',
      description: 'Most capable Claude model for the hardest, longest-running tasks.',
      effort: {
        default: 'high',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
          { value: 'xhigh' },
          { value: 'max' },
          ULTRACODE_EFFORT_OPTION,
        ],
      },
    },
    {
      value: 'sonnet',
      label: 'Sonnet',
      description: 'Latest Sonnet model for everyday coding tasks.',
      effort: {
        default: 'high',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
          { value: 'xhigh' },
          { value: 'max' },
          ULTRACODE_EFFORT_OPTION,
        ],
      },
    },
    {
      value: 'sonnet[1m]',
      label: 'Sonnet (1M context)',
      description: 'Latest Sonnet model with a 1M context window.',
      effort: {
        default: 'high',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
          { value: 'xhigh' },
          { value: 'max' },
          ULTRACODE_EFFORT_OPTION,
        ],
      },
    },
    {
      value: 'opus',
      label: 'Opus',
      description: 'Latest Opus model for complex reasoning and coding tasks.',
      effort: {
        default: 'high',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
          { value: 'xhigh' },
          { value: 'max' },
          ULTRACODE_EFFORT_OPTION,
        ],
      },
    },
    {
      value: 'opus[1m]',
      label: 'Opus (1M context)',
      description: 'Latest Opus model with a 1M context window.',
      effort: {
        default: 'high',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
          { value: 'xhigh' },
          { value: 'max' },
          ULTRACODE_EFFORT_OPTION,
        ],
      },
    },
    {
      value: 'haiku',
      label: 'Haiku',
      description: 'Fast and efficient Claude model for simple tasks.',
      // `medium` is the level Claude Code already runs Haiku at when none is sent, so
      // sessions that predate this control keep the effort they have been running with.
      // Ultracode is left out: standing workflow orchestration is not what Haiku is for.
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
      value: 'opusplan',
      label: 'Opus Plan',
      description: 'Use Opus while planning, then switch to Sonnet for execution.',
      effort: {
        default: 'high',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
          { value: 'xhigh' },
          { value: 'max' },
          ULTRACODE_EFFORT_OPTION,
        ],
      },
    },
    ...CLAUDE_PINNED_MODEL_OPTIONS,
  ],
  DEFAULT: 'default',
};

export const findClaudeModelOption = (model: string | undefined | null): ProviderModelOption | null => {
  const normalizedModel = typeof model === 'string' ? model.trim() : '';
  if (!normalizedModel) {
    return null;
  }

  return CLAUDE_PREDEFINED_MODELS.OPTIONS.find((option) => option.value === normalizedModel) ?? null;
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

/** Exported for tests. */
export const extractClaudeEventModel = (event: ClaudeInitEvent, sessionId: string): string | null => {
  const eventSessionId = event.sessionId ?? event.session_id;
  if (eventSessionId && eventSessionId !== sessionId) {
    return null;
  }

  const contentModel = extractClaudeModelFromMessageContent(event.message?.content);
  if (contentModel) {
    return contentModel;
  }

  const directModel = event.model?.trim();
  if (directModel && !isPlaceholderProviderModel(directModel)) {
    return directModel;
  }

  const messageModel = event.message?.model?.trim();
  return messageModel && !isPlaceholderProviderModel(messageModel) ? messageModel : null;
};

const extractTaggedContent = (content: string, tagName: string): string | null => {
  const escapedTagName = tagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`<${escapedTagName}>([\\s\\S]*?)<\\/${escapedTagName}>`).exec(content);
  return match ? match[1] : null;
};

const extractClaudeModelFromTextContent = (content: string): string | null => {
  const localCommandStdout = extractTaggedContent(content, 'local-command-stdout');
  if (localCommandStdout !== null) {
    const cleanedStdout = stripAnsiSequences(localCommandStdout).replace(/\s+/g, ' ').trim();
    const changedModel = /(?:set|changed|switched)\s+model\s+to\s+(.+?)\.?$/i.exec(cleanedStdout);
    const stdoutModel = changedModel?.[1]?.trim();
    // A placeholder stdout hit must not shadow a real <model> tag further down.
    if (stdoutModel && !isPlaceholderProviderModel(stdoutModel)) {
      return stdoutModel;
    }
  }

  const modelTag = extractTaggedContent(content, 'model')?.trim();
  return modelTag && !isPlaceholderProviderModel(modelTag) ? modelTag : null;
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

    // extractClaudeModelFromTextContent rejects placeholders, so a placeholder
    // part yields null here and a later part can still supply the real model.
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
    return CLAUDE_PREDEFINED_MODELS;
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
}
