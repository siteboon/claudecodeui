import { query } from '@anthropic-ai/claude-agent-sdk';

import { resolveClaudeCodeExecutablePath } from '@/shared/claude-cli-path.js';
import { SESSION_TITLE_MAX_WIDTH, truncateSessionTitle } from '@/shared/utils.js';
import type { AnyRecord } from '@/shared/types.js';

/**
 * Names a session from its first message, the way the Claude CLI names its own.
 *
 * The CLI writes an `ai-title` record into its transcript for sessions started
 * in a terminal, but CloudCLI runs the CLI through the SDK and never gets one,
 * so a session here kept its raw first prompt as a name. This asks the model
 * for a short title instead, once, in a throwaway query on the user's own
 * configuration.
 */

// A title that takes longer than this is not worth holding the session for;
// the caller falls back to the truncated first message.
const TITLE_TIMEOUT_MS = 20_000;

// The CLI skips title generation for very short prompts, and so do we: a
// two-word greeting says nothing about the task.
const MIN_PROMPT_LENGTH = 10;

const TITLE_SYSTEM_PROMPT_APPEND = 'You name chat sessions. Reply with a title only.';

/**
 * Builds the naming request.
 *
 * The width budget is stated the way the code measures it — a CJK character
 * costs two — because a model asked for "sixteen characters" writes sixteen
 * Latin letters, which is half the space a Chinese title needs.
 */
function buildTitlePrompt(firstMessage: string): string {
  const maxChineseCharacters = SESSION_TITLE_MAX_WIDTH / 2;
  return [
    'Write a title for the chat session that starts with the message below.',
    `Rules: at most ${maxChineseCharacters} Chinese characters of visual width — a Latin letter or digit counts as half a Chinese character, so at most ${SESSION_TITLE_MAX_WIDTH} of them.`,
    'Name the task the user wants done, not the fact that they wrote to you.',
    'Write it in the language of the message.',
    'No quotes, no trailing punctuation, no explanation. Output the title only.',
    '',
    'Message:',
    firstMessage,
  ].join('\n');
}

/**
 * Strips the wrapping the model still sometimes adds — quotes, a "Title:"
 * prefix, a trailing period — and fits the result into the width budget.
 */
function sanitizeTitle(rawValue: string): string {
  const firstLine = rawValue.split(/\r?\n/).map((line) => line.trim()).find((line) => line.length > 0) ?? '';
  const withoutPrefix = firstLine.replace(/^(?:title|标题|标题[:：])\s*[:：]\s*/iu, '');
  const withoutQuotes = withoutPrefix.replace(/^["'“”‘’《》]+|["'“”‘’《》]+$/gu, '').trim();
  return truncateSessionTitle(withoutQuotes.replace(/[.。;；]+$/u, '').trim());
}

/**
 * Asks Claude for a title for one session. Resolves to `null` whenever no
 * usable title came back: a missing answer, an error, an abort, or a message
 * too short to name anything. Never rejects — naming is a nicety, and a
 * failure must not surface to the caller that created the session.
 */
export async function generateClaudeSessionTitle(
  firstMessage: string,
  options: { cwd?: string; signal?: AbortSignal } = {},
): Promise<string | null> {
  const prompt = firstMessage.trim();
  if (prompt.length < MIN_PROMPT_LENGTH) {
    return null;
  }

  const abortController = new AbortController();
  const onAbort = () => abortController.abort();
  if (options.signal?.aborted) {
    return null;
  }
  options.signal?.addEventListener('abort', onAbort);
  const timer = setTimeout(() => abortController.abort(), TITLE_TIMEOUT_MS);

  try {
    const queryInstance = query({
      prompt: buildTitlePrompt(prompt),
      options: {
        persistSession: false,
        // Naming reads one message; it needs no tools and no session of its own.
        tools: [],
        allowedTools: [],
        permissionMode: 'dontAsk',
        // The user's own model and credentials live in their settings files;
        // an isolated query would fall back to a model that may not exist here.
        settingSources: ['project', 'user', 'local'],
        strictMcpConfig: true,
        maxTurns: 1,
        cwd: options.cwd,
        abortController,
        pathToClaudeCodeExecutable: resolveClaudeCodeExecutablePath(process.env.CLAUDE_CLI_PATH),
        systemPrompt: { type: 'preset', preset: 'claude_code', append: TITLE_SYSTEM_PROMPT_APPEND },
      },
    });

    for await (const message of queryInstance as AsyncIterable<AnyRecord>) {
      if (message.type !== 'result') {
        continue;
      }
      if (message.subtype !== 'success') {
        return null;
      }
      const resultText = typeof message.result === 'string' ? message.result : '';
      return resultText.trim() ? sanitizeTitle(resultText) || null : null;
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
