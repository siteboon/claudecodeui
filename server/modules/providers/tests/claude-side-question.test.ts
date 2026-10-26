import assert from 'node:assert/strict';
import test from 'node:test';

import {
  askClaudeSideQuestion,
  askClaudeSideQuestionFromHistory,
} from '@/modules/providers/list/claude/claude-side-question.provider.js';
import { resolveClaudeCodeExecutablePath } from '@/shared/claude-cli-path.js';
import type {
  AnyRecord,
  BackgroundTaskSummary,
  NormalizedMessage,
  ProviderRuntimeContext,
  SideQuestionOutcome,
  SideQuestionRequest,
} from '@/shared/types.js';

/**
 * A side question runs on a read-only fork of the Claude session. These drive
 * the fork with a scripted SDK stream — the seam is `deps.createQuery` — and
 * check what the fork is asked (options, prompt text), what reaches the sink,
 * and which outcome each way the stream can end produces.
 */

const PROVIDER_SESSION_ID = 'native-side-session';
const APP_SESSION_ID = 'app-side-session';
const QUESTION = 'What file holds the router?';

type Scripted = {
  emit: (message: Record<string, unknown>) => void;
  end: () => void;
  fail: (error: Error) => void;
  /** The prompt iterable has finished (the CLI's stdin would close). */
  released: () => boolean;
  /** Every user message the code yielded on the prompt iterable. */
  promptMessages: unknown[];
  /** The `{ prompt, options }` of every `createQuery` call. */
  calls: Array<{ prompt: AsyncIterable<unknown>; options: AnyRecord }>;
  interrupted: () => boolean;
};

type QueueItem = { message: Record<string, unknown> } | { end: true } | { error: Error };

/** A stand-in for the SDK query: yields what the test emits, and reads the prompt like the CLI reads stdin. */
function createScriptedQuery(): { createQuery: NonNullable<ProviderRuntimeContext['createQuery']>; script: Scripted } {
  const queue: QueueItem[] = [];
  let wake: (() => void) | null = null;
  let released = false;
  let interrupted = false;
  const promptMessages: unknown[] = [];
  const calls: Scripted['calls'] = [];
  const push = (item: QueueItem) => { queue.push(item); wake?.(); };

  const script: Scripted = {
    emit: (message) => push({ message }),
    end: () => push({ end: true }),
    fail: (error) => push({ error }),
    released: () => released,
    promptMessages,
    calls,
    interrupted: () => interrupted,
  };

  const createQuery: NonNullable<ProviderRuntimeContext['createQuery']> = (input) => {
    calls.push(input);
    const { prompt, options } = input;

    void (async () => {
      if (typeof prompt === 'string') {
        promptMessages.push(prompt);
      } else {
        for await (const message of prompt) {
          promptMessages.push(message);
        }
      }
      released = true;
    })();

    // The real SDK ends its stream with an AbortError when its controller aborts.
    const controller = options.abortController as AbortController | undefined;
    controller?.signal.addEventListener('abort', () => push({ error: new Error('Claude Code process aborted by user') }));

    const iterator = (async function* () {
      for (;;) {
        if (queue.length === 0) {
          await new Promise<void>((resolve) => { wake = resolve; });
          wake = null;
          continue;
        }
        const next = queue.shift()!;
        if ('end' in next) {
          return;
        }
        if ('error' in next) {
          throw next.error;
        }
        yield next.message;
      }
    })();

    return Object.assign(iterator, {
      interrupt: async () => { interrupted = true; },
    });
  };

  return { createQuery, script };
}

const settle = () => new Promise((resolve) => { setTimeout(resolve, 25); });

async function waitFor(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200 && !condition(); attempt += 1) {
    await settle();
  }
  assert.ok(condition(), 'condition never became true');
}

function createRequest(overrides: Partial<SideQuestionRequest> = {}): SideQuestionRequest {
  return {
    appSessionId: APP_SESSION_ID,
    providerSessionId: PROVIDER_SESSION_ID,
    projectPath: '/tmp/side-question-project',
    question: QUESTION,
    model: 'claude-opus-5',
    signal: new AbortController().signal,
    ...overrides,
  };
}

function createSink() {
  const deltas: string[] = [];
  return { deltas, sink: { delta: (text: string) => { deltas.push(text); } } };
}

/** The text of a prompt message, whether its content is a string or text blocks. */
function promptText(message: unknown): string {
  if (typeof message === 'string') {
    return message;
  }
  const content = (message as { message?: { content?: unknown } })?.message?.content;
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((block) => (block && typeof block === 'object' && 'text' in block ? String((block as { text: unknown }).text) : ''))
      .join('');
  }
  return '';
}

const streamText = (text: string, parentToolUseId: string | null = null) => ({
  type: 'stream_event', session_id: PROVIDER_SESSION_ID, parent_tool_use_id: parentToolUseId,
  event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
});
const assistantText = (text: string) => ({
  type: 'assistant', session_id: PROVIDER_SESSION_ID, parent_tool_use_id: null,
  message: { role: 'assistant', content: [{ type: 'text', text }] },
});
const assistantToolUse = (text: string) => ({
  type: 'assistant', session_id: PROVIDER_SESSION_ID, parent_tool_use_id: null,
  message: {
    role: 'assistant',
    content: [
      { type: 'text', text },
      { type: 'tool_use', id: 'toolu_grep', name: 'Grep', input: { pattern: 'router' } },
    ],
  },
});
const assistantThinkingOnly = () => ({
  type: 'assistant', session_id: PROVIDER_SESSION_ID, parent_tool_use_id: null,
  message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'considering' }] },
});
const toolResult = () => ({
  type: 'user', session_id: PROVIDER_SESSION_ID, parent_tool_use_id: null,
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_grep', content: 'src/router.ts' }] },
});
const result = (subtype: string, text = '') => ({
  type: 'result', subtype, session_id: PROVIDER_SESSION_ID, result: text, duration_ms: 1, num_turns: 1, is_error: subtype !== 'success',
});
// What a resumed fork says first: the session's background tasks reported as
// stopped, closed with an empty result before any assistant message.
const forkStoppedNotice = () => ({
  type: 'system', subtype: 'task_notification', session_id: PROVIDER_SESSION_ID, task_id: 'bg1', tool_use_id: 'toolu_bg', status: 'stopped', summary: 'stopped', output_file: '',
});

const task = (overrides: Partial<BackgroundTaskSummary> = {}): BackgroundTaskSummary => ({
  taskId: 'bg1',
  toolUseId: 'toolu_bg',
  taskType: 'local_agent',
  description: 'Refactor the importer',
  startedAt: 1_000_000,
  ...overrides,
});

/** Starts a fork run against a fresh script; `now` sits 42 s after the default task's start. */
function startFork(options: { request?: Partial<SideQuestionRequest>; liveTasks?: BackgroundTaskSummary[] } = {}) {
  const { createQuery, script } = createScriptedQuery();
  const { deltas, sink } = createSink();
  const outcome = askClaudeSideQuestion(createRequest(options.request), sink, {
    createQuery,
    liveTasks: options.liveTasks ?? [],
    now: () => 1_042_000,
  });
  return { script, deltas, outcome };
}

test('the fork resumes the session read-only with every measured option', { timeout: 5000 }, async () => {
  const { script, outcome } = startFork();
  await waitFor(() => script.calls.length === 1);
  const { options } = script.calls[0]!;

  assert.equal(options.resume, PROVIDER_SESSION_ID);
  assert.equal(options.forkSession, true);
  assert.equal(options.persistSession, false);
  assert.deepEqual(options.tools, ['Read', 'Grep', 'Glob']);
  assert.deepEqual(options.allowedTools, ['Read', 'Grep', 'Glob']);
  assert.equal(options.permissionMode, 'dontAsk');
  assert.deepEqual(options.settingSources, []);
  assert.equal(options.maxTurns, 4);
  assert.equal(options.includePartialMessages, true);
  assert.equal(options.cwd, '/tmp/side-question-project');
  assert.equal(options.model, 'claude-opus-5');
  assert.ok(options.abortController instanceof AbortController);
  assert.equal(options.pathToClaudeCodeExecutable, resolveClaudeCodeExecutablePath(process.env.CLAUDE_CLI_PATH));
  assert.equal(options.systemPrompt?.type, 'preset');
  assert.equal(options.systemPrompt?.preset, 'claude_code');
  assert.equal(typeof options.systemPrompt?.append, 'string');
  assert.ok(options.systemPrompt.append.trim().length > 0, 'a short side-question instruction is appended');
  assert.equal(options.mcpServers, undefined);
  assert.equal(options.hooks, undefined);
  assert.equal(options.canUseTool, undefined);

  script.emit(assistantText('In src/router.ts.'));
  script.emit(result('success', 'In src/router.ts.'));
  await outcome;
});

test('the fork leaves the model to the SDK when the request names none', { timeout: 5000 }, async () => {
  const { script, outcome } = startFork({ request: { model: null } });
  await waitFor(() => script.calls.length === 1);
  assert.equal(script.calls[0]!.options.model, undefined);
  script.emit(assistantText('ok'));
  script.emit(result('success', 'ok'));
  await outcome;
});

test('aborting the request aborts the fork controller and ends with an error outcome', { timeout: 5000 }, async () => {
  const controller = new AbortController();
  const { script, deltas, outcome } = startFork({ request: { signal: controller.signal } });
  await waitFor(() => script.calls.length === 1);
  script.emit(streamText('Partial'));
  await waitFor(() => deltas.length === 1);

  controller.abort();
  const settled: SideQuestionOutcome = await outcome;

  assert.equal((script.calls[0]!.options.abortController as AbortController).signal.aborted, true);
  assert.equal(settled.status, 'error');
  assert.equal(settled.answer, 'Partial');
  await waitFor(() => script.released());
});

test('the early empty result of a resumed fork is skipped, the prompt stays open, and the answer still arrives', { timeout: 5000 }, async () => {
  const { script, deltas, outcome } = startFork();
  await waitFor(() => script.promptMessages.length === 1);

  script.emit(forkStoppedNotice());
  script.emit(result('success', ''));
  await settle();
  assert.equal(script.released(), false, 'stdin stays open past the early result');

  script.emit(streamText('In '));
  script.emit(streamText('src/router.ts.'));
  script.emit(assistantText('In src/router.ts.'));
  script.emit(result('success', 'In src/router.ts.'));

  assert.deepEqual(await outcome, { status: 'done', answer: 'In src/router.ts.' });
  assert.deepEqual(deltas, ['In ', 'src/router.ts.']);
  await waitFor(() => script.released());
  assert.equal(script.promptMessages.length, 1, 'exactly one user message is sent');
});

test('the user prompt lists live tasks with their age above the question', { timeout: 5000 }, async () => {
  const { script, outcome } = startFork({
    liveTasks: [
      task(),
      task({ taskId: 'bg2', toolUseId: 'toolu_bg2', taskType: 'local_workflow', description: '', startedAt: 1_030_000 }),
    ],
  });
  await waitFor(() => script.promptMessages.length === 1);
  const text = promptText(script.promptMessages[0]);

  assert.ok(text.includes(QUESTION), 'the question is in the prompt');
  const noteEnd = text.indexOf(QUESTION);
  const note = text.slice(0, noteEnd);
  assert.ok(note.includes('Refactor the importer'), 'a task is named by its description');
  assert.ok(note.includes('local_workflow'), 'a task without a description is named by its type');
  assert.match(note, /\b42\s*(s\b|sec)/i, 'seconds since startedAt, from the injected clock');
  assert.match(note, /\b12\s*(s\b|sec)/i);
  assert.match(note, /still running/i);
  assert.match(note, /artifact/i, 'a stopped notice is called an artifact of the fork');

  script.emit(assistantText('ok'));
  script.emit(result('success', 'ok'));
  await outcome;
});

test('with no live tasks the user prompt says explicitly that none are running', { timeout: 5000 }, async () => {
  const { script, outcome } = startFork({ liveTasks: [] });
  await waitFor(() => script.promptMessages.length === 1);
  const text = promptText(script.promptMessages[0]);

  const questionAt = text.indexOf(QUESTION);
  assert.ok(questionAt >= 0);
  assert.match(text.slice(0, questionAt), /no background tasks are running/i);

  script.emit(assistantText('ok'));
  script.emit(result('success', 'ok'));
  await outcome;
});

test('only top-level text deltas reach the sink, and a tool round adds a paragraph seam', { timeout: 5000 }, async () => {
  const { script, deltas, outcome } = startFork();
  await waitFor(() => script.calls.length === 1);

  script.emit(streamText('Looking.'));
  script.emit(assistantToolUse('Looking.'));
  script.emit(streamText('nested agent text', 'toolu_other'));
  script.emit(toolResult());
  script.emit(streamText('Found it.'));
  script.emit(assistantText('Found it.'));
  script.emit(result('success', 'Found it.'));

  assert.deepEqual(await outcome, { status: 'done', answer: 'Looking.\n\nFound it.' });
  assert.deepEqual(deltas, ['Looking.', '\n\n', 'Found it.']);
});

test('success with no streamed text delivers the result string as one delta', { timeout: 5000 }, async () => {
  const { script, deltas, outcome } = startFork();
  await waitFor(() => script.calls.length === 1);
  script.emit(assistantText('Plain answer'));
  script.emit(result('success', 'Plain answer'));

  assert.deepEqual(await outcome, { status: 'done', answer: 'Plain answer' });
  assert.deepEqual(deltas, ['Plain answer']);
});

test('success with neither streamed text nor a result string is an error', { timeout: 5000 }, async () => {
  const { script, outcome } = startFork();
  await waitFor(() => script.calls.length === 1);
  script.emit(assistantThinkingOnly());
  script.emit(result('success', ''));

  const settled = await outcome;
  assert.equal(settled.status, 'error');
  assert.equal(settled.answer, '');
});

test('error_max_turns with text is done: what it said is the answer', { timeout: 5000 }, async () => {
  const { script, outcome } = startFork();
  await waitFor(() => script.calls.length === 1);
  script.emit(streamText('It is probably src/router.ts.'));
  script.emit(assistantText('It is probably src/router.ts.'));
  script.emit(result('error_max_turns'));

  assert.deepEqual(await outcome, { status: 'done', answer: 'It is probably src/router.ts.' });
});

test('error_max_turns without text is an error', { timeout: 5000 }, async () => {
  const { script, outcome } = startFork();
  await waitFor(() => script.calls.length === 1);
  script.emit(assistantThinkingOnly());
  script.emit(result('error_max_turns'));

  const settled = await outcome;
  assert.equal(settled.status, 'error');
  assert.equal(settled.answer, '');
});

const leadingToolUse = () => ({
  type: 'assistant', session_id: PROVIDER_SESSION_ID, parent_tool_use_id: null,
  message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_grep', name: 'Grep', input: { pattern: 'router' } }] },
});

test('a leading tool round sends no seam: the answer never opens with a blank paragraph', { timeout: 5000 }, async () => {
  const { script, deltas, outcome } = startFork();
  await waitFor(() => script.calls.length === 1);
  script.emit(leadingToolUse());
  script.emit(toolResult());
  script.emit(streamText('Found it.'));
  script.emit(assistantText('Found it.'));
  script.emit(result('success', 'Found it.'));

  assert.deepEqual(await outcome, { status: 'done', answer: 'Found it.' });
  assert.deepEqual(deltas, ['Found it.']);
});

test('error_max_turns after only tool rounds is an error: a seam is not text', { timeout: 5000 }, async () => {
  const { script, deltas, outcome } = startFork();
  await waitFor(() => script.calls.length === 1);
  script.emit(leadingToolUse());
  script.emit(toolResult());
  script.emit(leadingToolUse());
  script.emit(toolResult());
  script.emit(result('error_max_turns'));

  const settled = await outcome;
  assert.equal(settled.status, 'error');
  assert.equal(settled.answer, '');
  assert.deepEqual(deltas, [], 'no seam is sent before any text');
});

test('success after only tool rounds with no result string is an error', { timeout: 5000 }, async () => {
  const { script, deltas, outcome } = startFork();
  await waitFor(() => script.calls.length === 1);
  script.emit(leadingToolUse());
  script.emit(toolResult());
  script.emit(result('success', ''));

  const settled = await outcome;
  assert.equal(settled.status, 'error');
  assert.equal(settled.answer, '');
  assert.deepEqual(deltas, []);
});

test('any other result subtype is an error that keeps the text delivered so far', { timeout: 5000 }, async () => {
  const { script, outcome } = startFork();
  await waitFor(() => script.calls.length === 1);
  script.emit(streamText('Half an answer'));
  script.emit(assistantText('Half an answer'));
  script.emit(result('error_during_execution'));

  const settled = await outcome;
  assert.equal(settled.status, 'error');
  assert.equal(settled.answer, 'Half an answer');
  assert.ok(settled.status === 'error' && settled.error.length > 0);
});

test('a stream that ends without a real result is an error, and the prompt closes', { timeout: 5000 }, async () => {
  const { script, outcome } = startFork();
  await waitFor(() => script.calls.length === 1);
  script.emit(forkStoppedNotice());
  script.emit(result('success', ''));
  script.emit(streamText('Cut'));
  script.emit(assistantText('Cut'));
  script.end();

  const settled = await outcome;
  assert.equal(settled.status, 'error');
  assert.equal(settled.answer, 'Cut');
  await waitFor(() => script.released());
});

test('a stream that throws resolves to an error outcome instead of rejecting', { timeout: 5000 }, async () => {
  const { script, outcome } = startFork();
  await waitFor(() => script.calls.length === 1);
  script.fail(new Error('CLI crashed'));

  const settled = await outcome;
  assert.equal(settled.status, 'error');
  assert.ok(settled.status === 'error' && settled.error.length > 0);
});

test('a createQuery that throws resolves to an error outcome instead of rejecting', { timeout: 5000 }, async () => {
  const { sink } = createSink();
  const settled = await askClaudeSideQuestion(createRequest(), sink, {
    createQuery: () => { throw new Error('spawn failed'); },
    liveTasks: [],
  });
  assert.equal(settled.status, 'error');
});

function historyMessage(role: 'user' | 'assistant', content: string, index: number, kind: NormalizedMessage['kind'] = 'text'): NormalizedMessage {
  return {
    id: `m${index}`,
    sessionId: APP_SESSION_ID,
    timestamp: new Date(1_700_000_000_000 + index * 1000).toISOString(),
    provider: 'codex',
    kind,
    role,
    content,
  };
}

function startHistory(history: NormalizedMessage[], request: Partial<SideQuestionRequest> = {}) {
  const { createQuery, script } = createScriptedQuery();
  const { deltas, sink } = createSink();
  const outcome = askClaudeSideQuestionFromHistory(createRequest({ model: 'gpt-5-codex', ...request }), history, sink, { createQuery });
  return { script, deltas, outcome };
}

test('the history path is read-only, does not resume, and ignores the request model', { timeout: 5000 }, async () => {
  const { script, deltas, outcome } = startHistory([historyMessage('user', 'hi', 1)]);
  await waitFor(() => script.calls.length === 1);
  const { options } = script.calls[0]!;

  assert.equal(options.resume, undefined);
  assert.equal(options.forkSession, undefined);
  assert.equal(options.model, undefined, 'another provider model id never reaches Claude');
  assert.equal(options.persistSession, false);
  assert.deepEqual(options.tools, ['Read', 'Grep', 'Glob']);
  assert.deepEqual(options.allowedTools, ['Read', 'Grep', 'Glob']);
  assert.equal(options.permissionMode, 'dontAsk');
  assert.deepEqual(options.settingSources, []);
  assert.equal(options.maxTurns, 4);
  assert.equal(options.mcpServers, undefined);
  assert.equal(options.hooks, undefined);
  assert.equal(options.canUseTool, undefined);

  script.emit(streamText('Answer from history'));
  script.emit(assistantText('Answer from history'));
  script.emit(result('success', 'Answer from history'));
  assert.deepEqual(await outcome, { status: 'done', answer: 'Answer from history' });
  assert.deepEqual(deltas, ['Answer from history']);
});

test('the history prompt is the text transcript in order, then the question', { timeout: 5000 }, async () => {
  const { script, outcome } = startHistory([
    historyMessage('user', 'FIRST-USER-LINE', 1),
    historyMessage('assistant', 'TOOL-CALL-CONTENT', 2, 'tool_use'),
    historyMessage('assistant', 'SECOND-ASSISTANT-LINE', 3),
    historyMessage('assistant', 'THINKING-CONTENT', 4, 'thinking'),
  ]);
  await waitFor(() => script.promptMessages.length >= 1);
  const text = script.promptMessages.map(promptText).join('\n');

  const first = text.indexOf('FIRST-USER-LINE');
  const second = text.indexOf('SECOND-ASSISTANT-LINE');
  const question = text.indexOf(QUESTION);
  assert.ok(first >= 0 && second > first && question > second, 'transcript in order, question last');
  assert.equal(text.includes('TOOL-CALL-CONTENT'), false, 'only text messages are kept');
  assert.equal(text.includes('THINKING-CONTENT'), false, 'only text messages are kept');

  script.emit(assistantText('ok'));
  script.emit(result('success', 'ok'));
  await outcome;
});

test('the history prompt keeps the newest text and drops the oldest past the budget', { timeout: 5000 }, async () => {
  const { script, outcome } = startHistory([
    historyMessage('user', `OLDEST-MARKER ${'a'.repeat(60_000)}`, 1),
    historyMessage('assistant', `MIDDLE-MARKER ${'b'.repeat(30_000)}`, 2),
    historyMessage('user', `NEWEST-MARKER ${'c'.repeat(30_000)}`, 3),
  ]);
  await waitFor(() => script.promptMessages.length >= 1);
  const text = script.promptMessages.map(promptText).join('\n');

  assert.equal(text.includes('OLDEST-MARKER'), false, 'the oldest end is trimmed');
  assert.ok(text.includes('NEWEST-MARKER'), 'the newest message survives');
  assert.ok(text.includes(QUESTION), 'the question is never trimmed');
  assert.ok(text.length <= 100_000 + QUESTION.length + 2_000, `prompt stays near the budget (was ${text.length})`);

  script.emit(assistantText('ok'));
  script.emit(result('success', 'ok'));
  await outcome;
});
