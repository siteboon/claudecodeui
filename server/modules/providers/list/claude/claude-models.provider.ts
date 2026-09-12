import { readFile } from 'node:fs/promises';

import { query } from '@anthropic-ai/claude-agent-sdk';

import { sessionsDb } from '@/modules/database/index.js';
import type { IProviderModels } from '@/shared/interfaces.js';
import type {
  ProviderCurrentActiveModel,
  ProviderModelOption,
  ProviderModelsDefinition,
} from '@/shared/types.js';
import { AppError, buildDefaultProviderCurrentActiveModel } from '@/shared/utils.js';

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

/**
 * Claude Code stamps locally-synthesized rows (API-error placeholders and the
 * like) with `model: "<synthetic>"`. Angle-bracketed values are placeholders,
 * never real model ids, and must not be surfaced as the session's model.
 */
const isPlaceholderModel = (model: string): boolean => model.startsWith('<') && model.endsWith('>');

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
  if (directModel && !isPlaceholderModel(directModel)) {
    return directModel;
  }

  const messageModel = event.message?.model?.trim();
  return messageModel && !isPlaceholderModel(messageModel) ? messageModel : null;
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
    const stdoutModel = changedModel?.[1]?.trim();
    // A placeholder stdout hit must not shadow a real <model> tag further down.
    if (stdoutModel && !isPlaceholderModel(stdoutModel)) {
      return stdoutModel;
    }
  }

  const modelTag = extractTaggedContent(content, 'model')?.trim();
  return modelTag && !isPlaceholderModel(modelTag) ? modelTag : null;
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

/** One entry of the SDK's `supportedModels()` answer, narrowed to the picker's fields. */
type ClaudeSdkModelInfo = {
  value: string;
  displayName?: string;
  description?: string;
  supportsEffort?: boolean;
  supportedEffortLevels?: string[];
};

/** How long a successful `supportedModels()` answer stays fresh. */
const LIVE_CATALOG_TTL_MS = 60_000;

/** Test seam: replaces the SDK round-trip with a fixture-backed reader. */
export type ClaudeProviderModelsDependencies = {
  readSupportedModels?: () => Promise<ClaudeSdkModelInfo[]>;
};

/**
 * Asks the Claude CLI which models this install can actually run.
 *
 * `supportedModels()` reads the initialize handshake the SDK already performs
 * when a query starts; it does not run a model turn. The original attempt at
 * this was disabled because the throwaway query left a session jsonl behind
 * (and listed the server's workspace as a project). `persistSession: false`
 * is exactly that fix, and an empty prompt generator makes the child exit as
 * soon as the handshake answer is in.
 */
const readClaudeCliModels = async (): Promise<ClaudeSdkModelInfo[]> => {
  // The SDK types the prompt loosely; the generator never yields, so nothing
  // reaches the model even if the CLI's stdin stays open past the handshake.
  const queryInstance = query({
    prompt: (async function* emptyPrompt() { /* yields nothing */ })(),
    options: { persistSession: false, maxTurns: 1 },
  } as Parameters<typeof query>[0]);
  try {
    return await queryInstance.supportedModels();
  } finally {
    try {
      await queryInstance.close();
    } catch {
      // A child that already exited on its own makes close() reject; the
      // catalog answer is in hand either way.
    }
  }
};

/**
 * Builds the picker catalog from the CLI answer.
 *
 * There is deliberately no curated fallback list behind this: a hardcoded
 * catalog goes stale against every CLI upgrade and account change, and the
 * picker surfacing the CLI failure beats quietly offering models this install
 * may not run. Ultracode stays a CloudCLI-side addition - the SDK has never
 * heard of it - and keeps its xhigh-only precondition.
 */
const buildCatalogFromCli = (models: ClaudeSdkModelInfo[]): ProviderModelsDefinition => {
  const options: ProviderModelOption[] = models
    .filter((model) => typeof model?.value === 'string' && model.value.trim())
    .map((model) => {
      const effortValues = model.supportsEffort === false
        ? []
        : [...new Set(model.supportedEffortLevels ?? [])];
      const effortOptions = effortValues.map((value) => ({ value }));
      return {
        value: model.value,
        label: model.displayName?.trim() || model.value,
        ...(model.description?.trim() ? { description: model.description.trim() } : {}),
        ...(effortOptions.length > 0
          ? {
            effort: {
              values: effortValues.includes('xhigh')
                ? [...effortOptions, ULTRACODE_EFFORT_OPTION]
                : effortOptions,
            },
          }
          : {}),
      };
    });

  if (options.length === 0) {
    throw new AppError('Claude reported no usable models.', {
      code: 'CLAUDE_MODELS_UNAVAILABLE',
      statusCode: 502,
    });
  }

  return {
    OPTIONS: options,
    DEFAULT: options.find((option) => option.value === 'default')?.value ?? options[0].value,
  };
};

export class ClaudeProviderModels implements IProviderModels {
  private readonly readSupportedModels: () => Promise<ClaudeSdkModelInfo[]>;
  private liveCatalog: Promise<ProviderModelsDefinition> | null = null;
  private liveCatalogExpiresAt = 0;

  constructor(dependencies: ClaudeProviderModelsDependencies = {}) {
    this.readSupportedModels = dependencies.readSupportedModels ?? readClaudeCliModels;
  }

  /**
   * Reports the picker catalog from the Claude CLI's initialize handshake.
   *
   * Spawning the CLI costs about a second, so a successful answer is cached
   * briefly and concurrent callers share one in-flight run (the picker, the
   * active-model lookup, and effort validation all resolve the catalog within
   * the same page load). A failed run is not cached; the next caller retries
   * rather than waiting out the TTL on an error.
   */
  async getSupportedModels(): Promise<ProviderModelsDefinition> {
    if (!this.liveCatalog || Date.now() >= this.liveCatalogExpiresAt) {
      const run = (async () => buildCatalogFromCli(await this.readSupportedModels()))();
      this.liveCatalog = run;
      this.liveCatalogExpiresAt = Date.now() + LIVE_CATALOG_TTL_MS;
      void run.catch(() => {
        if (this.liveCatalog === run) {
          this.liveCatalog = null;
          this.liveCatalogExpiresAt = 0;
        }
      });
    }

    return this.liveCatalog;
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
