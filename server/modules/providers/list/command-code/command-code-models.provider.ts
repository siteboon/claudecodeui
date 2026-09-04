import { readFile } from 'node:fs/promises';

import { sessionsDb } from '@/modules/database/index.js';
import type { IProviderModels } from '@/shared/interfaces.js';
import type {
  ProviderCurrentActiveModel,
  ProviderModelsDefinition,
} from '@/shared/types.js';
import { buildDefaultProviderCurrentActiveModel } from '@/shared/utils.js';

/**
 * Curated Command Code model catalog shipped as immutable CloudCLI defaults.
 *
 * Command Code exposes a large model catalog (`cmd --list-models` prints a
 * human "Available models · N models" grouped list, not machine-parseable
 * output), so the app ships a source-controlled subset of stable model ids.
 * The ids are the exact `-m` values Command Code accepts; a stale or invented
 * id is rejected at launch, so keep this list in sync with the CLI's catalog.
 */
export const COMMAND_CODE_PREDEFINED_MODELS: ProviderModelsDefinition = {
  OPTIONS: [
    {
      value: 'claude-sonnet-5',
      label: 'Claude Sonnet 5',
      description: 'Frontier balanced coding model.',
      effort: {
        default: 'medium',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
          { value: 'max' },
        ],
      },
    },
    {
      value: 'claude-sonnet-4-6',
      label: 'Claude Sonnet 4.6',
      description: 'Balanced agentic coding model.',
      effort: {
        default: 'medium',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
          { value: 'max' },
        ],
      },
    },
    {
      value: 'claude-opus-5',
      label: 'Claude Opus 5',
      description: 'Most capable model for the hardest, longest-running tasks.',
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
      value: 'claude-haiku-4-5-20251001',
      label: 'Claude Haiku 4.5',
      description: 'Fast and efficient model for simple tasks.',
      effort: {
        default: 'low',
        values: [
          { value: 'low' },
          { value: 'medium' },
        ],
      },
    },
    {
      value: 'deepseek/deepseek-v4-flash',
      label: 'DeepSeek V4 Flash',
      description: 'Fast hybrid-attention reasoning model.',
      effort: {
        default: 'low',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
        ],
      },
    },
    {
      value: 'deepseek/deepseek-v4-pro',
      label: 'DeepSeek V4 Pro',
      description: 'Deep reasoning model.',
      effort: {
        default: 'medium',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
        ],
      },
    },
    {
      value: 'google/gemini-3.7-flash',
      label: 'Gemini 3.7 Flash',
      description: 'Fast Google model.',
    },
    {
      value: 'google/gemini-3.5-flash',
      label: 'Gemini 3.5 Flash',
      description: 'Fast Google model.',
    },
    {
      value: 'moonshotai/Kimi-K2.7-Code',
      label: 'Kimi K2.7 Code',
      description: 'Coding-tuned Kimi model.',
    },
    {
      value: 'Qwen/Qwen3.7-Plus',
      label: 'Qwen 3.7 Plus',
      description: 'Balanced Qwen model.',
    },
    {
      value: 'zai-org/GLM-5.3',
      label: 'GLM 5.3',
      description: 'Balanced GLM model.',
    },
    {
      value: 'z-ai/glm-5.3-flash',
      label: 'GLM 5.3 Flash',
      description: 'Fast GLM model.',
    },
  ],
  DEFAULT: 'claude-sonnet-4-6',
};

type CommandCodeTranscriptEntry = {
  type?: unknown;
  message?: {
    model?: unknown;
    role?: unknown;
    content?: unknown;
  };
  model?: unknown;
};

/**
 * Reads the model a Command Code session is running with from the transcript
 * tail.
 *
 * Command Code stores the active model on assistant transcript entries
 * (`"model":"..."` on each assistant message) rather than in the session's
 * `.meta.json` sidecar, so the newest assistant row is the authoritative
 * source. This mirrors the Claude adapter's `readClaudeSessionModelFromJsonl`.
 */
const readCommandCodeSessionModelFromJsonl = async (
  jsonlPath: string,
): Promise<string | null> => {
  try {
    const content = await readFile(jsonlPath, 'utf8');
    const lines = content.split(/\r?\n/);

    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const line = lines[index]?.trim();
      if (!line) {
        continue;
      }

      try {
        const entry = JSON.parse(line) as CommandCodeTranscriptEntry;
        const entryModel = typeof entry.model === 'string'
          ? entry.model
          : (typeof entry.message?.model === 'string' ? entry.message.model : undefined);
        if (entryModel?.trim()) {
          return entryModel.trim();
        }
      } catch {
        // Skip malformed JSONL lines that can appear during concurrent writes.
      }
    }
  } catch {
    // Missing/unreadable transcripts fall through to the catalog default.
  }

  return null;
};

export class CommandCodeProviderModels implements IProviderModels {
  async getSupportedModels(): Promise<ProviderModelsDefinition> {
    return COMMAND_CODE_PREDEFINED_MODELS;
  }

  async getCurrentActiveModel(sessionId?: string): Promise<ProviderCurrentActiveModel> {
    if (!sessionId?.trim()) {
      return buildDefaultProviderCurrentActiveModel(await this.getSupportedModels());
    }

    try {
      const jsonlPath = sessionsDb.getSessionById(sessionId)?.jsonl_path;
      const activeModel = jsonlPath
        ? await readCommandCodeSessionModelFromJsonl(jsonlPath)
        : null;
      if (activeModel) {
        return { model: activeModel };
      }
    } catch {
      // Fall through to the provider default when the session-backed lookup fails.
    }

    return buildDefaultProviderCurrentActiveModel(await this.getSupportedModels());
  }
}
