import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { query, type Settings } from '@anthropic-ai/claude-agent-sdk';

import { resolveClaudeCodeExecutablePath } from '@/shared/claude-cli-path.js';
import {
  SESSION_TITLE_MAX_WIDTH,
  measureTitleWidth,
  truncateSessionTitle,
} from '@/shared/index.js';
import type { AnyRecord } from '@/shared/index.js';

/**
 * Names a session from its first message, the way the Claude CLI names its own.
 *
 * The CLI writes an `ai-title` record into its transcript for sessions started
 * in a terminal, but CloudCLI runs the CLI through the SDK and never gets one,
 * so a session here kept its raw first prompt as a name. This asks the model
 * for a short title instead, once, in an isolated throwaway query that reads
 * only the user's API/model settings — never CLAUDE.md, hooks, or plugins.
 */

// Total budget across primary, optional over-length condensation, and fallback.
const TITLE_TIMEOUT_MS = 25_000;

// Remaining time required before attempting an extra condensation/fallback call.
const MIN_REMAINING_RETRY_MS = 3_000;

// Skip only trivial greetings (`你好`, `hi`, `hello`); a 6-9 character Chinese
// message already exceeds the 16-unit sidebar width and needs an AI title.
const MIN_PROMPT_WIDTH = 9;

// Cap huge pasted logs so the title query stays fast and focused on the intent.
const MAX_PROMPT_CHARS = 1_500;

const SAFE_USER_SETTING_KEYS = [
  'env',
  'model',
  'apiKeyHelper',
  'awsAuthRefresh',
  'awsCredentialExport',
  'otelHeadersHelper',
  'forceLoginMethod',
  'forceLoginOrgUUID',
] as const;

type TitlePromptRunnerParams = {
  prompt: string;
  systemPrompt: string;
  model?: string;
  cwd?: string;
  signal: AbortSignal;
  settings: Settings;
};

type TitleGenerationOptions = {
  cwd?: string;
  /** Session or default main model used as fallback if the small model fails. */
  model?: string;
  signal?: AbortSignal;
  /** Test seam replacing the SDK query; production callers omit this. */
  runPrompt?: (params: TitlePromptRunnerParams) => Promise<string | null>;
};

function buildTitleSystemPrompt(): string {
  const maxChineseCharacters = Math.floor(SESSION_TITLE_MAX_WIDTH / 2);
  const preferredChineseCharacters = Math.max(1, maxChineseCharacters - 1);
  return [
    'You generate a concise sidebar title for a chat session. Reply with ONLY the title text.',
    'Rules:',
    `- Visual width MUST be <= ${SESSION_TITLE_MAX_WIDTH} units (1 Chinese/CJK character = 2 units, 1 ASCII letter/digit/space = 1 unit). That means at most ${maxChineseCharacters} Chinese characters (aim for 4 to ${preferredChineseCharacters} Chinese characters) or ${SESSION_TITLE_MAX_WIDTH} English characters.`,
    '- Return a complete, self-contained phrase that fits the limit so no ellipsis or truncation is needed.',
    '- Name the core task or topic in the same language as the user message.',
    '- Plain text ONLY: NO emoji, NO icons, NO mode tags, NO quotes, NO ellipsis, NO trailing punctuation.',
    'Examples:',
    '- Message: 调研微信红包支付资质和审核时间 -> 微信红包资质调研',
    '- Message: Investigate the streaming queue regression in chat -> Fix queue stream',
  ].join('\n');
}

function buildShortenSystemPrompt(): string {
  const maxChineseCharacters = Math.floor(SESSION_TITLE_MAX_WIDTH / 2);
  const preferredChineseCharacters = Math.max(1, maxChineseCharacters - 1);
  return [
    'You shorten an over-long chat session title. Reply with ONLY the shortened title text.',
    `Rules: visual width MUST be <= ${SESSION_TITLE_MAX_WIDTH} units (at most ${maxChineseCharacters} Chinese characters, aim for 4 to ${preferredChineseCharacters}, or ${SESSION_TITLE_MAX_WIDTH} ASCII characters).`,
    'Keep it a complete phrase in the same language. Plain text only: NO emoji, NO quotes, NO ellipsis, NO punctuation.',
  ].join('\n');
}

/**
 * The user's settings file, at the path the CLI itself reads. `CLAUDE_CONFIG_DIR`
 * selects another profile, and the server forwards its whole env to every CLI it
 * spawns, so the same override has to apply here — otherwise a title query runs
 * with the default profile's auth and model while the session runs with the
 * selected profile's.
 */
function userSettingsPath(): string {
  const configDirectory = process.env.CLAUDE_CONFIG_DIR?.trim();
  const baseDirectory = configDirectory && path.isAbsolute(configDirectory)
    ? configDirectory
    : path.join(os.homedir(), '.claude');
  return path.join(baseDirectory, 'settings.json');
}

/**
 * Loads only auth/env/model keys from the user's settings file while disabling
 * hooks and thinking, so `settingSources: []` keeps CLAUDE.md, hooks, and
 * plugins completely isolated from title generation.
 */
async function loadSanitizedUserSettings(): Promise<Settings> {
  const base: Settings = {
    alwaysThinkingEnabled: false,
    disableAllHooks: true,
    env: { CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' },
  };

  try {
    const raw = await readFile(userSettingsPath(), 'utf8');
    const parsed = JSON.parse(raw) as AnyRecord;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return base;
    }

    const result: Record<string, unknown> = {};
    for (const key of SAFE_USER_SETTING_KEYS) {
      if (parsed[key] !== undefined) {
        result[key] = parsed[key];
      }
    }
    const allowedSettings = result as Settings;
    return {
      ...allowedSettings,
      ...base,
      env: { ...allowedSettings.env, ...base.env },
    };
  } catch {
    return base;
  }
}

// One emoji the way it is written, not just its base code point: a skin-tone
// modifier, a variation selector, or a ZWJ-joined sequence all belong to the
// pictograph and have to go with it. Removing only `\p{Extended_Pictographic}`
// leaves the modifier behind, which is not a pictograph and survives the width check.
const EMOJI_CLUSTER = String.raw`\p{Extended_Pictographic}(?:\p{Emoji_Modifier}|\uFE0F|\u200D\p{Extended_Pictographic}(?:\p{Emoji_Modifier})?)*`;
const LEADING_EMOJI = new RegExp(`^(?:\\s|${EMOJI_CLUSTER}|[•·:：-])+`, 'gu');
const TRAILING_EMOJI = new RegExp(`(?:\\s|${EMOJI_CLUSTER}|[.。;；:：!！?？…])+$`, 'gu');

/**
 * Strips formatting noise (tool XML leaks, prefixes, quotes, emojis, trailing
 * punctuation/ellipses) without cutting the title short.
 */
function cleanModelTitle(rawValue: string): string | null {
  const trimmed = rawValue.trim();
  if (!trimmed || /<[|｜]DSML[|｜]|<function_calls>|<invoke\b/i.test(trimmed)) {
    return null;
  }

  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^(?:title|session\s*title|标题|会话标题)\s*[:：]\s*/iu, '').trim())
    .filter(Boolean);
  let candidate = lines[0] ?? '';
  if (!candidate) {
    return null;
  }

  // Strip surrounding quotes/brackets and leading/trailing emojis or mode tags.
  let previous = '';
  while (candidate !== previous) {
    previous = candidate;
    candidate = candidate
      .replace(/^["'“”‘’《》「」【】`]+|["'“”‘’《》「」【】`]+$/gu, '')
      .replace(LEADING_EMOJI, '')
      .replace(TRAILING_EMOJI, '')
      .replace(/\.{2,}$/u, '')
      .trim();
  }

  return candidate || null;
}

async function runSdkTitlePrompt({
  prompt,
  systemPrompt,
  model,
  cwd,
  signal,
  settings,
}: TitlePromptRunnerParams): Promise<string | null> {
  const queryInstance = query({
    prompt,
    options: {
      persistSession: false,
      tools: [],
      allowedTools: [],
      permissionMode: 'dontAsk',
      settingSources: [],
      env: { ...process.env, CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' },
      settings,
      strictMcpConfig: true,
      maxTurns: 1,
      effort: 'low',
      ...(model ? { model } : {}),
      cwd,
      abortController: createLinkedAbortController(signal),
      pathToClaudeCodeExecutable: resolveClaudeCodeExecutablePath(process.env.CLAUDE_CLI_PATH),
      systemPrompt,
    },
  });

  for await (const message of queryInstance as AsyncIterable<AnyRecord>) {
    if (message.type !== 'result') {
      continue;
    }
    if (message.subtype !== 'success' || message.is_error) {
      return null;
    }
    const resultText = typeof message.result === 'string' ? message.result : '';
    return resultText.trim() || null;
  }
  return null;
}

function createLinkedAbortController(parentSignal: AbortSignal): AbortController {
  const controller = new AbortController();
  if (parentSignal.aborted) {
    controller.abort();
    return controller;
  }
  parentSignal.addEventListener('abort', () => controller.abort(), { once: true });
  return controller;
}

function buildModelCandidates(fallbackModel?: string): Array<string | undefined> {
  const candidates: Array<string | undefined> = ['haiku'];
  const trimmedFallback = fallbackModel?.trim();
  if (trimmedFallback && trimmedFallback !== 'default' && trimmedFallback !== 'haiku') {
    candidates.push(trimmedFallback);
  }
  candidates.push(undefined);
  return candidates;
}

/**
 * Asks Claude for a title for one session. Resolves to `null` whenever no
 * usable title came back: a missing answer, an error, an abort, or a trivial
 * greeting too short to rename. Never rejects — naming is a nicety, and a
 * failure must not surface to the caller that created the session.
 */
export async function generateClaudeSessionTitle(
  firstMessage: string,
  options: TitleGenerationOptions = {},
): Promise<string | null> {
  const prompt = firstMessage.trim();
  if (!prompt || measureTitleWidth(prompt) < MIN_PROMPT_WIDTH) {
    return null;
  }

  if (options.signal?.aborted) {
    return null;
  }

  const abortController = new AbortController();
  const onAbort = () => abortController.abort();
  options.signal?.addEventListener('abort', onAbort);
  const deadline = Date.now() + TITLE_TIMEOUT_MS;
  const timer = setTimeout(() => abortController.abort(), TITLE_TIMEOUT_MS);

  const runPrompt = options.runPrompt ?? runSdkTitlePrompt;
  const titlePrompt = `Message:\n${prompt.slice(0, MAX_PROMPT_CHARS)}`;
  const systemPrompt = buildTitleSystemPrompt();

  try {
    const settings = await loadSanitizedUserSettings();
    const candidates = buildModelCandidates(options.model);

    for (let index = 0; index < candidates.length; index += 1) {
      if (abortController.signal.aborted) {
        return null;
      }
      if (index > 0 && deadline - Date.now() < MIN_REMAINING_RETRY_MS) {
        return null;
      }

      const candidateModel = candidates[index];
      let raw: string | null = null;
      try {
        raw = await runPrompt({
          prompt: titlePrompt,
          systemPrompt,
          model: candidateModel,
          cwd: options.cwd,
          signal: abortController.signal,
          settings,
        });
      } catch {
        raw = null;
      }

      const cleaned = raw ? cleanModelTitle(raw) : null;
      if (!cleaned) {
        continue;
      }

      if (measureTitleWidth(cleaned) <= SESSION_TITLE_MAX_WIDTH) {
        return cleaned;
      }

      // The model produced a clean phrase that slightly overshot the 16-unit
      // width budget; ask the same working model once to tighten it instead of
      // chopping the end off with an ellipsis.
      if (deadline - Date.now() >= MIN_REMAINING_RETRY_MS && !abortController.signal.aborted) {
        try {
          const shortenedRaw = await runPrompt({
            prompt: `Title to shorten:\n${cleaned}`,
            systemPrompt: buildShortenSystemPrompt(),
            model: candidateModel,
            cwd: options.cwd,
            signal: abortController.signal,
            settings,
          });
          const shortened = shortenedRaw ? cleanModelTitle(shortenedRaw) : null;
          if (shortened && measureTitleWidth(shortened) <= SESSION_TITLE_MAX_WIDTH) {
            return shortened;
          }
        } catch {
          // Fall back to width truncation of the already-clean AI title below.
        }
      }

      return truncateSessionTitle(cleaned) || null;
    }

    return null;
  } catch {
    // A timeout or a missing CLI is a normal outcome here; the caller keeps the
    // truncated first message instead.
    return null;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
  }
}
