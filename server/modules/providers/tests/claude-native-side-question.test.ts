import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ClaudeSessionsProvider } from '@/modules/providers/list/claude/claude-sessions.provider.js';
import { CLAUDE_PREDEFINED_MODELS } from '@/modules/providers/list/claude/claude-models.provider.js';
import {
  claudeRuntime,
  isClaudeSDKSessionActive,
  listClaudeSDKBackgroundWork,
  queryClaudeSDK,
} from '@/modules/providers/list/claude/claude-runtime.provider.js';
import type {
  NormalizedMessage,
  ProviderRuntimeContext,
  SideQuestionOutcome,
  SideQuestionRequest,
} from '@/shared/types.js';

/**
 * A Claude side question asked while the session's own process is live goes
 * to that process (`Query.askSideQuestion`, SDK 0.3.311, not in its typings)
 * instead of starting a fork. These drive a run with a scripted SDK stream —
 * the seam is `context.createQuery`, as in `claude-runtime-hold.test.ts` — and
 * ask in both busy states: mid-turn (after the user message, before its
 * `result`) and after the turn, while the process is held open only for the
 * turn's background work. The measured choice is native in both; the fork is
 * used only without a live query or when the live query lacks the method.
 */

const SESSION_ID = 'app-native-side-session';
const NATIVE_ID = 'native-side-session';
const QUESTION = 'Which file holds the router?';
const NATIVE_ANSWER = 'The router lives in src/router.ts.';
const FORK_ANSWER = 'FORK ANSWER';

type NativeAsk = (question: string, options?: { signal?: AbortSignal }) => Promise<unknown>;

type Scripted = {
  emit: (message: Record<string, unknown>) => void;
  end: () => void;
};

/**
 * A stand-in for the SDK query of the session's own run. `askSideQuestion`
 * is attached only when given, so "a live query without the method" is the
 * plain object.
 */
function createScriptedQuery(askSideQuestion?: NativeAsk): {
  createQuery: NonNullable<ProviderRuntimeContext['createQuery']>;
  script: Scripted;
} {
  const queue: Array<Record<string, unknown> | null> = [];
  let wake: (() => void) | null = null;

  const script: Scripted = {
    emit: (message) => { queue.push(message); wake?.(); },
    end: () => { queue.push(null); wake?.(); },
  };

  const createQuery: NonNullable<ProviderRuntimeContext['createQuery']> = ({ prompt }) => {
    void (async () => {
      for await (const _message of prompt) { /* the CLI reads its stdin */ }
    })();

    const iterator = (async function* () {
      for (;;) {
        if (queue.length === 0) {
          await new Promise<void>((resolve) => { wake = resolve; });
          wake = null;
          continue;
        }
        const next = queue.shift();
        if (next === null || next === undefined) {
          return;
        }
        yield next;
      }
    })();

    const instance = Object.assign(iterator, {
      interrupt: async () => {},
      stopTask: async () => {},
    });
    if (askSideQuestion) {
      // SDK 0.3.311's method is `askSideQuestion(e, t) { … this.request(…) }`:
      // called detached from its query it throws, so the fake does too.
      Object.assign(instance, {
        askSideQuestion(this: unknown, question: string, options?: { signal?: AbortSignal }) {
          if (this !== instance) {
            throw new TypeError('askSideQuestion was called without its query as `this`');
          }
          return askSideQuestion(question, options);
        },
      });
    }
    return instance;
  };

  return { createQuery, script };
}

/** The fork's own query: answers with FORK_ANSWER and counts how often it was started. */
function createForkQuery(): { createQuery: NonNullable<ProviderRuntimeContext['createQuery']>; calls: () => number } {
  let calls = 0;
  const createQuery: NonNullable<ProviderRuntimeContext['createQuery']> = () => {
    calls += 1;
    const iterator = (async function* () {
      yield {
        type: 'assistant', session_id: 'fork-session', parent_tool_use_id: null,
        message: { role: 'assistant', content: [{ type: 'text', text: FORK_ANSWER }] },
      };
      yield { type: 'result', subtype: 'success', session_id: 'fork-session', result: FORK_ANSWER, duration_ms: 1, num_turns: 1 };
    })();
    return Object.assign(iterator, { interrupt: async () => {} });
  };
  return { createQuery, calls: () => calls };
}

function makeContext(createQuery: NonNullable<ProviderRuntimeContext['createQuery']>): ProviderRuntimeContext {
  const sessions = new ClaudeSessionsProvider({ getLiveRunStartTime: () => null });
  return {
    resolveProviderSessionId: () => null,
    resolveResumeModel: async () => undefined,
    getProviderModels: async () => CLAUDE_PREDEFINED_MODELS as never,
    normalizeMessage: (raw, sessionId) => sessions.normalizeMessage(raw, sessionId),
    isProviderInstalled: async () => true,
    createQuery,
  };
}

const settle = () => new Promise((resolve) => { setTimeout(resolve, 25); });

async function waitFor(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200 && !condition(); attempt += 1) {
    await settle();
  }
  assert.ok(condition(), 'condition never became true');
}

const init = () => ({ type: 'system', subtype: 'init', session_id: NATIVE_ID });
const partialText = (text: string) => ({
  type: 'stream_event', session_id: NATIVE_ID, parent_tool_use_id: null,
  event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
});
const result = () => ({ type: 'result', subtype: 'success', session_id: NATIVE_ID, result: 'done', duration_ms: 1, num_turns: 1 });

/**
 * Starts the session's run, brings it mid-turn (init and some streamed text,
 * no `result`), hands it to the test, then ends the turn and the stream.
 */
async function withMidTurnRun(
  askSideQuestion: NativeAsk | undefined,
  runTest: (cwd: string) => Promise<void>,
): Promise<void> {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'claude-native-side-'));
  const { createQuery, script } = createScriptedQuery(askSideQuestion);
  const sent: NormalizedMessage[] = [];
  const writer = { send: (message: NormalizedMessage) => { sent.push(message); }, userId: null };

  try {
    const done = queryClaudeSDK('hello', { sessionId: SESSION_ID, cwd }, writer as never, makeContext(createQuery));
    script.emit(init());
    script.emit(partialText('Working on it'));
    await waitFor(() => isClaudeSDKSessionActive(SESSION_ID));
    await settle();

    await runTest(cwd);

    script.emit(result());
    script.end();
    await done;
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

const toolUse = (id: string, name: string, input: Record<string, unknown>) => ({
  type: 'assistant', session_id: NATIVE_ID, parent_tool_use_id: null,
  message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] },
});
const ack = (id: string, text: string, toolUseResult: Record<string, unknown>) => ({
  type: 'user', session_id: NATIVE_ID, parent_tool_use_id: null,
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text }] },
  tool_use_result: toolUseResult,
});
const taskStarted = (taskId: string, toolUseId: string) => ({
  type: 'system', subtype: 'task_started', session_id: NATIVE_ID, task_id: taskId, tool_use_id: toolUseId, description: `Task ${taskId}`, task_type: 'local_workflow',
});

/**
 * Starts the session's run, launches a background workflow and ends the turn
 * with its `result`, so the process is held open only for that work (as in
 * `claude-runtime-hold.test.ts`), hands it to the test, then ends the stream.
 */
async function withHeldRun(
  askSideQuestion: NativeAsk | undefined,
  runTest: (cwd: string) => Promise<void>,
): Promise<void> {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'claude-native-side-held-'));
  const { createQuery, script } = createScriptedQuery(askSideQuestion);
  const sent: NormalizedMessage[] = [];
  const writer = { send: (message: NormalizedMessage) => { sent.push(message); }, userId: null };

  try {
    const done = queryClaudeSDK('hello', { sessionId: SESSION_ID, cwd }, writer as never, makeContext(createQuery));
    script.emit(init());
    script.emit(toolUse('toolu_wf', 'Workflow', { script: 'export const meta = {}' }));
    script.emit(taskStarted('wf1', 'toolu_wf'));
    script.emit(ack('toolu_wf', 'Workflow launched in background. Task ID: wf1', { status: 'async_launched', taskId: 'wf1', taskType: 'local_workflow' }));
    script.emit(result());
    await waitFor(() => sent.some((message) => message.kind === 'complete'));
    assert.deepEqual(listClaudeSDKBackgroundWork().map((entry) => entry.sessionId), [SESSION_ID], 'the process is held for the workflow');
    assert.equal(isClaudeSDKSessionActive(SESSION_ID), true);

    await runTest(cwd);

    script.end();
    await done;
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

function makeRequest(cwd: string | null, signal = new AbortController().signal): SideQuestionRequest {
  return {
    appSessionId: SESSION_ID,
    providerSessionId: NATIVE_ID,
    projectPath: cwd,
    question: QUESTION,
    model: null,
    signal,
  };
}

async function ask(request: SideQuestionRequest, forkCreateQuery: NonNullable<ProviderRuntimeContext['createQuery']>): Promise<{ outcome: SideQuestionOutcome; deltas: string[] }> {
  const deltas: string[] = [];
  const outcome = await claudeRuntime.askSideQuestion(
    request,
    { delta: (text: string) => { deltas.push(text); } },
    makeContext(forkCreateQuery),
  );
  return { outcome, deltas };
}

test('mid-turn: the question and the signal reach the live query, the answer arrives as one delta, and no fork starts', { concurrency: false }, async () => {
  const nativeCalls: Array<{ question: string; options?: { signal?: AbortSignal } }> = [];
  const native: NativeAsk = async (question, options) => {
    nativeCalls.push({ question, options });
    return { response: NATIVE_ANSWER, synthetic: false };
  };
  const fork = createForkQuery();

  await withMidTurnRun(native, async (cwd) => {
    const controller = new AbortController();
    const { outcome, deltas } = await ask(makeRequest(cwd, controller.signal), fork.createQuery);

    assert.equal(nativeCalls.length, 1, 'the live query\'s askSideQuestion is called once');
    assert.equal(nativeCalls[0]?.question, QUESTION);
    assert.equal(nativeCalls[0]?.options?.signal, controller.signal, 'the request\'s abort signal is passed on');
    assert.deepEqual(deltas, [NATIVE_ANSWER], 'the whole response is exactly one delta');
    assert.deepEqual(outcome, { status: 'done', answer: NATIVE_ANSWER });
    assert.equal(fork.calls(), 0, 'the fork\'s createQuery is not called');
  });
});

test('after the turn, held for background work: the live query answers natively and no fork starts', { concurrency: false }, async () => {
  const nativeCalls: Array<{ question: string; options?: { signal?: AbortSignal } }> = [];
  const native: NativeAsk = async (question, options) => {
    nativeCalls.push({ question, options });
    return { response: NATIVE_ANSWER, synthetic: false };
  };
  const fork = createForkQuery();

  await withHeldRun(native, async (cwd) => {
    const controller = new AbortController();
    const { outcome, deltas } = await ask(makeRequest(cwd, controller.signal), fork.createQuery);

    assert.equal(nativeCalls.length, 1, 'the held query\'s askSideQuestion is called once');
    assert.equal(nativeCalls[0]?.question, QUESTION);
    assert.equal(nativeCalls[0]?.options?.signal, controller.signal, 'the request\'s abort signal is passed on');
    assert.deepEqual(deltas, [NATIVE_ANSWER], 'the whole response is exactly one delta');
    assert.deepEqual(outcome, { status: 'done', answer: NATIVE_ANSWER });
    assert.equal(fork.calls(), 0, 'the fork\'s createQuery is not called');
  });
});

test('mid-turn: a null answer from the live query is an error outcome', { concurrency: false }, async () => {
  const fork = createForkQuery();
  await withMidTurnRun(async () => null, async (cwd) => {
    const { outcome, deltas } = await ask(makeRequest(cwd), fork.createQuery);
    assert.equal(outcome.status, 'error');
    assert.equal(outcome.answer, '');
    assert.deepEqual(deltas, []);
  });
});

test('mid-turn: an empty response from the live query is an error outcome', { concurrency: false }, async () => {
  const fork = createForkQuery();
  await withMidTurnRun(async () => ({ response: '', synthetic: false }), async (cwd) => {
    const { outcome, deltas } = await ask(makeRequest(cwd), fork.createQuery);
    assert.equal(outcome.status, 'error');
    assert.deepEqual(deltas, []);
  });
});

test('mid-turn: a throw from the live query resolves as an error outcome, never a rejection', { concurrency: false }, async () => {
  const fork = createForkQuery();
  await withMidTurnRun(async () => { throw new Error('side question channel closed'); }, async (cwd) => {
    const { outcome, deltas } = await ask(makeRequest(cwd), fork.createQuery);
    assert.equal(outcome.status, 'error');
    assert.match(outcome.status === 'error' ? outcome.error : '', /side question channel closed/);
    assert.deepEqual(deltas, []);
  });
});

test('a live query without askSideQuestion falls back to the fork', { concurrency: false }, async () => {
  const fork = createForkQuery();
  await withMidTurnRun(undefined, async (cwd) => {
    const { outcome } = await ask(makeRequest(cwd), fork.createQuery);
    assert.equal(fork.calls(), 1, 'the fork answers');
    assert.deepEqual(outcome, { status: 'done', answer: FORK_ANSWER });
  });
});

test('without a live query the fork answers', { concurrency: false }, async () => {
  assert.equal(isClaudeSDKSessionActive(SESSION_ID), false, 'no run is live for this session');
  const fork = createForkQuery();
  const { outcome } = await ask(makeRequest(null), fork.createQuery);
  assert.equal(fork.calls(), 1, 'the fork answers');
  assert.deepEqual(outcome, { status: 'done', answer: FORK_ANSWER });
});
