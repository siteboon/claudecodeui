import { query } from '@anthropic-ai/claude-agent-sdk';

import { resolveClaudeCodeExecutablePath } from '@/shared/claude-cli-path.js';
import type {
  AnyRecord,
  BackgroundTaskSummary,
  NormalizedMessage,
  ProviderRuntimeContext,
  SideQuestionOutcome,
  SideQuestionRequest,
  SideQuestionSink,
} from '@/shared/types.js';

/**
 * Asks a question on the side of a Claude session, on a read-only fork or
 * (when there is no native session to resume) from the session's history.
 *
 * Both entry points share the same streaming machinery: a forked/history
 * query with the same read-only tool set, the same three traps worked
 * around (see below), and the same rules for turning the SDK's stream into
 * one `SideQuestionOutcome`.
 */

// The CLI/SDK tools a side question is allowed to use: look, never touch.
const SIDE_QUESTION_TOOLS = ['Read', 'Grep', 'Glob'];

// A short instruction appended to the `claude_code` preset so the fork knows
// it is answering a side question, not continuing the conversation.
const SIDE_QUESTION_SYSTEM_PROMPT_APPEND =
  'This is a side question asked apart from the ongoing conversation, on a read-only '
  + 'copy of it. Do not use any tool that changes anything. Answer briefly, in the '
  + 'language the question was asked in.';

// Starting value for how much of the session's text history the fallback
// path carries in the prompt, oldest first, trimmed from the oldest end.
// Not measured: say so here until it is, rather than presenting a guess as
// a measured number.
const HISTORY_CHAR_BUDGET = 100_000;

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return String(error ?? 'The side question failed for an unknown reason.');
}

/**
 * The live-tasks note placed above the question in the fork's prompt.
 *
 * Trap 3: the live task list has to be told to the fork in the prompt itself
 * — the system prompt's own note about them got lost to the fork's own
 * notices in 2 of 3 answers measured on 2026-10-26 — and it has to say
 * plainly that any notice of these tasks stopping is an artifact of the fork
 * reporting them as such on resume (trap 1), not a real event.
 */
function buildLiveTasksNote(liveTasks: BackgroundTaskSummary[], now: () => number): string {
  if (liveTasks.length === 0) {
    return 'No background tasks are running; any shown as running has ended.';
  }
  const nowMs = now();
  const lines = liveTasks.map((task) => {
    const label = task.description.trim() || task.taskType;
    const seconds = Math.max(0, Math.round((nowMs - task.startedAt) / 1000));
    return `- ${label} (still running, ${seconds}s)`;
  });
  return [
    'The session has these background tasks still running on its own turn:',
    ...lines,
    'Any notice that one of these has stopped is an artifact of this read-only fork, not real.',
  ].join('\n');
}

function buildForkPromptText(question: string, liveTasks: BackgroundTaskSummary[], now: () => number): string {
  return `${buildLiveTasksNote(liveTasks, now)}\n\n${question}`;
}

/** The session's text messages, oldest first, trimmed from the oldest end to the budget. */
function buildHistoryTranscript(history: NormalizedMessage[]): string {
  const lines = history
    .filter((message) => message.kind === 'text' && (message.role === 'user' || message.role === 'assistant'))
    .map((message) => `${message.role}: ${message.content}`);
  const transcript = lines.join('\n');
  return transcript.length > HISTORY_CHAR_BUDGET
    ? transcript.slice(transcript.length - HISTORY_CHAR_BUDGET)
    : transcript;
}

type ForkExtraOptions = {
  resume?: string;
  forkSession?: true;
  model?: string;
};

/**
 * Runs one read-only Claude query (forked or history-based) to completion
 * and turns its stream into a `SideQuestionOutcome`. Never rejects: every
 * failure, thrown or reported, comes back as an `error` outcome.
 */
async function runSideQuestionQuery(
  request: SideQuestionRequest,
  sink: SideQuestionSink,
  promptText: string,
  extraOptions: ForkExtraOptions,
  createQueryFn: NonNullable<ProviderRuntimeContext['createQuery']>,
): Promise<SideQuestionOutcome> {
  const abortController = new AbortController();
  const onAbort = () => abortController.abort();
  if (request.signal.aborted) {
    abortController.abort();
  } else {
    request.signal.addEventListener('abort', onAbort);
  }

  // Trap 2: a string prompt lets the SDK close stdin the moment the early
  // (or real) result arrives. An async iterable that stays open until we
  // release it keeps the process alive for the real answer.
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  const promptStream = (async function* () {
    yield { type: 'user', message: { role: 'user', content: promptText }, parent_tool_use_id: null };
    await held;
  })();

  const options: AnyRecord = {
    ...extraOptions,
    persistSession: false,
    tools: SIDE_QUESTION_TOOLS,
    allowedTools: SIDE_QUESTION_TOOLS,
    permissionMode: 'dontAsk',
    settingSources: [],
    maxTurns: 4,
    includePartialMessages: true,
    cwd: request.projectPath ?? undefined,
    abortController,
    pathToClaudeCodeExecutable: resolveClaudeCodeExecutablePath(process.env.CLAUDE_CLI_PATH),
    systemPrompt: { type: 'preset', preset: 'claude_code', append: SIDE_QUESTION_SYSTEM_PROMPT_APPEND },
  };

  const finish = (outcome: SideQuestionOutcome): SideQuestionOutcome => {
    request.signal.removeEventListener('abort', onAbort);
    release();
    return outcome;
  };

  let answer = '';
  let hasText = false;
  // Trap 1: a resumed fork reports the session's background tasks as
  // stopped and closes that with an empty `result` before any real turn
  // runs. Nothing before the first top-level `assistant` message counts.
  let sawTopLevelAssistant = false;

  let queryInstance: AsyncIterable<AnyRecord>;
  try {
    queryInstance = createQueryFn({ prompt: promptStream, options }) as AsyncIterable<AnyRecord>;
  } catch (error) {
    return finish({ status: 'error', error: errorMessage(error), answer });
  }

  try {
    for await (const message of queryInstance) {
      if (message.type === 'stream_event' && !message.parent_tool_use_id) {
        const delta = message.event;
        if (delta?.type === 'content_block_delta' && delta.delta?.type === 'text_delta') {
          const text = String(delta.delta.text ?? '');
          if (text.length > 0) {
            sink.delta(text);
            answer += text;
            hasText = true;
          }
        }
        continue;
      }

      if (message.type === 'assistant' && !message.parent_tool_use_id) {
        sawTopLevelAssistant = true;
        const content = message.message?.content;
        const hasToolUse = Array.isArray(content)
          && content.some((block: AnyRecord) => block?.type === 'tool_use');
        // The seam is not text: it only separates text already delivered,
        // never opens the answer.
        if (hasToolUse && hasText) {
          sink.delta('\n\n');
          answer += '\n\n';
        }
        continue;
      }

      if (message.type === 'result') {
        if (!sawTopLevelAssistant) {
          continue;
        }
        const subtype = message.subtype;
        const resultText = typeof message.result === 'string' ? message.result : '';
        if (subtype === 'success') {
          if (hasText) {
            return finish({ status: 'done', answer });
          }
          if (resultText.length > 0) {
            sink.delta(resultText);
            return finish({ status: 'done', answer: resultText });
          }
          return finish({ status: 'error', error: 'Claude returned no answer.', answer: '' });
        }
        if (subtype === 'error_max_turns') {
          // The turn cap cut it short; what it said so far is the answer.
          if (hasText) {
            return finish({ status: 'done', answer });
          }
          return finish({ status: 'error', error: 'Claude reached its turn limit before answering.', answer: '' });
        }
        return finish({ status: 'error', error: `Claude ended the side question (${subtype}).`, answer });
      }
    }
    return finish({ status: 'error', error: 'The side question ended with no answer.', answer });
  } catch (error) {
    return finish({ status: 'error', error: errorMessage(error), answer });
  }
}

/**
 * Answers a side question on a read-only fork of the session's native
 * Claude process (`resume` + `forkSession: true`). See the module doc for
 * the shared streaming rules and the three traps this works around.
 */
export async function askClaudeSideQuestion(
  request: SideQuestionRequest,
  sink: SideQuestionSink,
  deps: {
    createQuery?: ProviderRuntimeContext['createQuery'];
    liveTasks: BackgroundTaskSummary[];
    now?: () => number;
  },
): Promise<SideQuestionOutcome> {
  const createQueryFn = deps.createQuery
    ?? (query as unknown as NonNullable<ProviderRuntimeContext['createQuery']>);
  const now = deps.now ?? Date.now;
  const promptText = buildForkPromptText(request.question, deps.liveTasks, now);

  return runSideQuestionQuery(request, sink, promptText, {
    resume: request.providerSessionId ?? undefined,
    forkSession: true,
    // Keeps the fork on the session's prompt cache; left unset lets the SDK
    // pick its own default instead of sending another provider's model id.
    model: request.model || undefined,
  }, createQueryFn);
}

/**
 * Answers a side question from the session's own text history, for a
 * provider with no native fork capability. Read-only, like the fork path,
 * but never resumes a Claude session and never sends another provider's
 * model id to Claude.
 */
export async function askClaudeSideQuestionFromHistory(
  request: SideQuestionRequest,
  history: NormalizedMessage[],
  sink: SideQuestionSink,
  deps: { createQuery?: ProviderRuntimeContext['createQuery'] },
): Promise<SideQuestionOutcome> {
  const createQueryFn = deps.createQuery
    ?? (query as unknown as NonNullable<ProviderRuntimeContext['createQuery']>);
  const transcript = buildHistoryTranscript(history);
  const promptText = `${transcript}\n\n${request.question}`;

  return runSideQuestionQuery(request, sink, promptText, {}, createQueryFn);
}
