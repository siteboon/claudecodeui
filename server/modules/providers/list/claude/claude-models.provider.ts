import { readFile } from 'node:fs/promises';
import os from 'node:os';

import { query } from '@anthropic-ai/claude-agent-sdk';

import { sessionsDb } from '@/modules/database/index.js';
import { resolveClaudeCodeExecutablePath } from '@/shared/claude-cli-path.js';
import type { IProviderModels } from '@/shared/interfaces.js';
import type {
  ProviderCurrentActiveModel,
  ProviderModelOption,
  ProviderModelsDefinition,
} from '@/shared/types.js';
import { buildDefaultProviderCurrentActiveModel } from '@/shared/utils.js';

export const CLAUDE_FALLBACK_MODELS: ProviderModelsDefinition = {
  OPTIONS: [
    {
      value: 'default',
      label: 'Default (recommended)',
      description: 'Use the Claude Code default model (currently Opus 5 with 1M context)',
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
      value: 'sonnet[1m]',
      label: 'Sonnet (1M context)',
      description: 'Sonnet 5 for long sessions · $3/$15 per Mtok',
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
      description: 'Opus 5 · Best for everyday, complex tasks · $5/$25 per Mtok',
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
      label: 'Opus (1M context)',
      description: 'Opus 5 with 1M context · Best for everyday, complex tasks · $5/$25 per Mtok',
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

/**
 * How long to wait for the CLI to start up and answer the catalog request.
 * Generous because the probe spawns a process; the fallback table covers the
 * timeout, so a slow machine degrades to stale labels rather than a stall.
 */
const SUPPORTED_MODELS_TIMEOUT_MS = 30_000;

/** Effort level the API applies when a request does not ask for one. */
const DEFAULT_EFFORT = 'high';

/** One entry of the CLI's own model catalog, as far as this adapter reads it. */
type ClaudeCliModel = {
  value?: unknown;
  displayName?: unknown;
  description?: unknown;
  supportsEffort?: unknown;
  supportedEffortLevels?: unknown;
};

/** In-flight probe shared by concurrent callers. */
let supportedModelsProbe: Promise<ProviderModelsDefinition> | null = null;

const toProviderModelOption = (entry: ClaudeCliModel): ProviderModelOption | null => {
  const value = typeof entry.value === 'string' ? entry.value.trim() : '';
  if (!value) {
    return null;
  }

  const displayName = typeof entry.displayName === 'string' ? entry.displayName.trim() : '';
  const effortLevels = Array.isArray(entry.supportedEffortLevels)
    ? entry.supportedEffortLevels.filter((level): level is string => typeof level === 'string' && level.length > 0)
    : [];

  return {
    value,
    label: displayName || value,
    ...(typeof entry.description === 'string' && entry.description
      ? { description: entry.description }
      : {}),
    ...(entry.supportsEffort === true && effortLevels.length > 0
      ? {
        effort: {
          default: effortLevels.includes(DEFAULT_EFFORT) ? DEFAULT_EFFORT : effortLevels[0],
          values: effortLevels.map((level) => ({ value: level })),
        },
      }
      : {}),
  };
};

/**
 * Combines the CLI's catalog with the static table.
 *
 * Options the CLI reports win outright — they carry the current names,
 * descriptions and effort levels. Entries only the static table knows are
 * appended rather than dropped: the CLI stops advertising older aliases well
 * before it stops accepting them, and dropping one would silently reset the
 * stored selection of every user who picked it.
 */
const mergeWithFallbackModels = (options: ProviderModelOption[]): ProviderModelsDefinition => {
  const advertised = new Set(options.map((option) => option.value));
  const retained = CLAUDE_FALLBACK_MODELS.OPTIONS.filter((option) => !advertised.has(option.value));

  return {
    OPTIONS: [...options, ...retained],
    DEFAULT: advertised.has(CLAUDE_FALLBACK_MODELS.DEFAULT)
      ? CLAUDE_FALLBACK_MODELS.DEFAULT
      : options[0].value,
  };
};

/**
 * Asks the installed Claude CLI which models it supports.
 *
 * The query runs with `persistSession: false` and outside any project
 * directory, so the probe leaves no session transcript behind — the reason
 * this lookup used to be disabled. The prompt stream ends immediately without
 * yielding: `supportedModels()` is answered from the CLI's startup handshake,
 * so no turn is ever started and no tokens are spent.
 *
 * The executable is resolved the same way the runtime resolves it. Without
 * that, the SDK falls back to its own bundled CLI, which is typically older
 * than the one actually running chats and answers with a stale catalog.
 */
const probeClaudeSupportedModels = async (): Promise<ProviderModelsDefinition> => {
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), SUPPORTED_MODELS_TIMEOUT_MS);
  timeout.unref?.();

  let queryInstance: ReturnType<typeof query> | null = null;
  try {
    queryInstance = query({
      prompt: (async function* () {})(),
      options: {
        abortController,
        cwd: os.tmpdir(),
        settingSources: [],
        persistSession: false,
        pathToClaudeCodeExecutable: resolveClaudeCodeExecutablePath(process.env.CLAUDE_CLI_PATH),
      },
    });

    const reported = await queryInstance.supportedModels();
    const options = (Array.isArray(reported) ? reported : [])
      .map((entry) => toProviderModelOption((entry ?? {}) as ClaudeCliModel))
      .filter((option): option is ProviderModelOption => option !== null);

    if (options.length === 0) {
      console.warn('[Claude models] CLI reported no models; using the built-in catalog');
      return CLAUDE_FALLBACK_MODELS;
    }

    return mergeWithFallbackModels(options);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[Claude models] Unable to read the CLI catalog (${message}); using the built-in catalog`);
    return CLAUDE_FALLBACK_MODELS;
  } finally {
    clearTimeout(timeout);
    try {
      await queryInstance?.close();
    } catch {
      // The probe is finished either way; a failed close must not surface.
    }
  }
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
  /**
   * Reads the catalog from the installed Claude CLI, falling back to the
   * static table when it cannot be reached.
   *
   * The CLI is the only thing that knows which aliases it accepts and what
   * they resolve to today, so hardcoding that list means every model release
   * leaves the picker showing last release's names. The fallback covers a
   * missing or outdated CLI and any failure of the probe itself.
   *
   * Concurrent callers share one probe: the models service caches the result,
   * but its cache is cold on the first request after a restart, and several
   * clients tend to ask at once.
   */
  async getSupportedModels(): Promise<ProviderModelsDefinition> {
    if (!supportedModelsProbe) {
      supportedModelsProbe = probeClaudeSupportedModels()
        .finally(() => {
          supportedModelsProbe = null;
        });
    }

    return supportedModelsProbe;
  }

  async getCurrentActiveModel(sessionId?: string): Promise<ProviderCurrentActiveModel> {
    // Deliberately the static default rather than the probed catalog: this is
    // a fallback on a per-session hot path, and spawning the CLI to learn a
    // value that has been `default` across every catalog is not worth it.
    if (!sessionId?.trim()) {
      return buildDefaultProviderCurrentActiveModel(CLAUDE_FALLBACK_MODELS);
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

    return buildDefaultProviderCurrentActiveModel(CLAUDE_FALLBACK_MODELS);
  }
}
