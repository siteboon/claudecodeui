import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ClaudeSessionsProvider } from '@/modules/providers/list/claude/claude-sessions.provider.js';
import { CLAUDE_PREDEFINED_MODELS } from '@/modules/providers/list/claude/claude-models.provider.js';
import {
  claudeRuntime,
  queryClaudeSDK,
} from '@/modules/providers/list/claude/claude-runtime.provider.js';
import type {
  NormalizedMessage,
  ProviderRuntimeContext,
  SideQuestionOutcome,
  SideQuestionRequest,
} from '@/shared/types.js';

/**
 * A native side question asked near the end of a turn used to come back
 * "Side question cancelled": the turn's own `result` released stdin at
 * once, and the CLI cancels every side question in flight when the session
 * it belongs to shuts down. These drive `queryClaudeSDK` with a scripted
 * SDK stream (the seam is `context.createQuery`, as in
 * `claude-runtime-hold.test.ts`) and a controllable `askSideQuestion` stub
 * (as in `claude-native-side-question.test.ts`), and watch the held prompt
 * stream directly: the CLI exits only once it ends.
 */

const SESSION_ID = 'app-hold-side-question';
const NATIVE_ID = 'native-hold-side-question';
const QUESTION = 'Which file holds the router?';
const NATIVE_ANSWER = 'The router lives in src/router.ts.';
const FORK_ANSWER = 'FORK ANSWER';

type NativeAsk = (question: string, options?: { signal?: AbortSignal }) => Promise<unknown>;

type Scripted = {
  emit: (message: Record<string, unknown>) => void;
  end: () => void;
  released: () => boolean;
  /** How many emitted messages the production side has finished handling. */
  consumed: () => number;
};

/**
 * A stand-in for the session's own query: scripted messages plus a toggled
 * `askSideQuestion`, and a `released` flag read off its held stdin — the CLI
 * exits once that stream ends, so this is the whole outcome to watch.
 */
function createScriptedQuery(askSideQuestion?: NativeAsk): {
  createQuery: NonNullable<ProviderRuntimeContext['createQuery']>;
  script: Scripted;
} {
  const queue: Array<Record<string, unknown> | null> = [];
  let wake: (() => void) | null = null;
  let released = false;
  // Advances only once the generator below is resumed for the *next* item —
  // which the consumer only asks for after it finishes handling this one.
  let consumed = 0;

  const script: Scripted = {
    emit: (message) => { queue.push(message); wake?.(); },
    end: () => { queue.push(null); wake?.(); },
    released: () => released,
    consumed: () => consumed,
  };

  const createQuery: NonNullable<ProviderRuntimeContext['createQuery']> = ({ prompt }) => {
    void (async () => {
      for await (const _message of prompt) { /* the CLI reads its stdin */ }
      released = true;
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
        consumed += 1;
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

// A short, fixed pause used only where a predicate already confirmed the
// event that must precede a *negative* assertion (see `waitFor` below) — it
// is never the only thing a test waits on.
const settle = () => new Promise((resolve) => { setTimeout(resolve, 25); });

/**
 * Polls `condition` until it holds, instead of guessing a fixed delay — the
 * 25ms `settle()` this replaced was long enough alone but not always under
 * the full suite's parallel load. Fails with a clear message once
 * `timeoutMs` passes without the condition becoming true.
 */
async function waitFor(
  condition: () => boolean,
  { timeoutMs = 2000, stepMs = 5 }: { timeoutMs?: number; stepMs?: number } = {},
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() >= deadline) {
      assert.ok(condition(), `condition never became true within ${timeoutMs}ms`);
      return;
    }
    await new Promise<void>((resolve) => { setTimeout(resolve, stepMs); });
  }
}

/**
 * Emits a scripted message and waits for the production side to have pulled
 * it (and finished its synchronous handling of it) off the queue, rather
 * than guessing how long that takes. `Scripted.consumed()` only advances once
 * the generator in `createScriptedQuery` is resumed for the *next* item,
 * which the consumer only does after it is done processing this one.
 */
async function emitAndFlush(script: Scripted, message: Record<string, unknown>): Promise<void> {
  const before = script.consumed();
  script.emit(message);
  await waitFor(() => script.consumed() > before);
}

/** Wraps a native stub so tests can wait for it having actually been called. */
function trackCalls(native: NativeAsk): { native: NativeAsk; called: () => boolean } {
  let calls = 0;
  return {
    native: (question, options) => { calls += 1; return native(question, options); },
    called: () => calls > 0,
  };
}

const init = () => ({ type: 'system', subtype: 'init', session_id: NATIVE_ID });
const result = () => ({ type: 'result', subtype: 'success', session_id: NATIVE_ID, result: 'done', duration_ms: 1, num_turns: 1 });
const toolUse = (id: string, name: string, input: Record<string, unknown>) => ({
  type: 'assistant', session_id: NATIVE_ID, parent_tool_use_id: null,
  message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] },
});
const ack = (id: string, text: string, toolUseResult: Record<string, unknown>) => ({
  type: 'user', session_id: NATIVE_ID, parent_tool_use_id: null,
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text }] },
  tool_use_result: toolUseResult,
});
const taskStarted = (taskId: string, toolUseId: string, taskType: string) => ({
  type: 'system', subtype: 'task_started', session_id: NATIVE_ID, task_id: taskId, tool_use_id: toolUseId, description: `Task ${taskId}`, task_type: taskType,
});
const taskNotification = (taskId: string, toolUseId: string, status: string) => ({
  type: 'system', subtype: 'task_notification', session_id: NATIVE_ID, task_id: taskId, tool_use_id: toolUseId, status, summary: `Task ${taskId} ${status}`, output_file: '',
});

function makeRequest(cwd: string | null, signal: AbortSignal): SideQuestionRequest {
  return {
    appSessionId: SESSION_ID,
    providerSessionId: NATIVE_ID,
    projectPath: cwd,
    question: QUESTION,
    model: null,
    signal,
  };
}

async function ask(
  request: SideQuestionRequest,
  forkCreateQuery: NonNullable<ProviderRuntimeContext['createQuery']>,
): Promise<{ outcome: SideQuestionOutcome; deltas: string[] }> {
  const deltas: string[] = [];
  const outcome = await claudeRuntime.askSideQuestion(
    request,
    { delta: (text: string) => { deltas.push(text); } },
    makeContext(forkCreateQuery),
  );
  return { outcome, deltas };
}

test('a turn that ends while a native side question is pending keeps the input open until the answer arrives, then releases it', { concurrency: false }, async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'claude-side-question-hold-'));
  let resolveNative!: (value: unknown) => void;
  const { native, called: nativeCalled } = trackCalls(
    () => new Promise((resolve) => { resolveNative = resolve; }),
  );
  const { createQuery, script } = createScriptedQuery(native);
  const fork = createForkQuery();
  const sent: NormalizedMessage[] = [];
  const writer = { send: (message: NormalizedMessage) => { sent.push(message); }, userId: null };

  try {
    const done = queryClaudeSDK('hello', { sessionId: SESSION_ID, cwd }, writer as never, makeContext(createQuery));
    await emitAndFlush(script, init());

    const controller = new AbortController();
    const asked = ask(makeRequest(cwd, controller.signal), fork.createQuery);
    await waitFor(nativeCalled);

    // The turn ends with nothing backgrounded — ordinarily that releases
    // stdin at once (see the "no hold needed" branch in `queryClaudeSDK`).
    await emitAndFlush(script, result());
    // `emitAndFlush` only confirms the result message's own synchronous
    // handling ran; give any (buggy) async release path a moment too, so
    // this negative check is not vacuous.
    await settle();
    assert.equal(script.released(), false, 'the pending side question keeps stdin open past the turn\'s own result');

    resolveNative({ response: NATIVE_ANSWER, synthetic: false });
    const { outcome, deltas } = await asked;
    assert.deepEqual(outcome, { status: 'done', answer: NATIVE_ANSWER });
    assert.deepEqual(deltas, [NATIVE_ANSWER]);
    assert.equal(fork.calls(), 0, 'the native call answered; the fork never started');

    await waitFor(() => script.released());

    script.end();
    await done;
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('a CLI cancellation the side question\'s own signal did not cause (a new turn superseding this one) is answered once more on the fork', { concurrency: false }, async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'claude-side-question-hold-'));
  // The native call rejects only once its own query's stdin has actually
  // been released — by the second turn below, not by the question's signal.
  let rejectNative!: (error: unknown) => void;
  const { native, called: nativeCalled } = trackCalls(
    () => new Promise((_resolve, reject) => { rejectNative = reject; }),
  );
  const first = createScriptedQuery(native);
  const second = createScriptedQuery();
  const fork = createForkQuery();
  const writer = { send: () => {}, userId: null };

  try {
    const firstRun = queryClaudeSDK('hello', { sessionId: SESSION_ID, cwd }, writer as never, makeContext(first.createQuery));
    await emitAndFlush(first.script, init());

    const controller = new AbortController();
    const asked = ask(makeRequest(cwd, controller.signal), fork.createQuery);
    await waitFor(nativeCalled);

    // A new turn on the same session supersedes the held one directly
    // (`releaseHeldSession`), which does not consult the pending-question
    // count: the first process is let go while the question is still out.
    const secondRun = queryClaudeSDK('continue', { sessionId: SESSION_ID, cwd }, writer as never, makeContext(second.createQuery));
    await waitFor(() => first.script.released());
    assert.equal(first.script.released(), true, 'the superseded process is let go');

    rejectNative(new Error('Side question cancelled'));
    const { outcome } = await asked;

    assert.equal(fork.calls(), 1, 'a cancellation we did not cause is retried on the fork');
    assert.deepEqual(outcome, { status: 'done', answer: FORK_ANSWER });

    first.script.end();
    await firstRun;
    second.script.emit(init());
    second.script.emit(result());
    second.script.end();
    await secondRun;
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('a dismissed question (its own signal aborted) is not retried', { concurrency: false }, async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'claude-side-question-hold-'));
  const native: NativeAsk = async () => { throw new Error('Side question cancelled'); };
  const { createQuery, script } = createScriptedQuery(native);
  const fork = createForkQuery();
  const writer = { send: () => {}, userId: null };

  try {
    const done = queryClaudeSDK('hello', { sessionId: SESSION_ID, cwd }, writer as never, makeContext(createQuery));
    await emitAndFlush(script, init());

    // `dismiss` aborts the question's own signal before the runtime call
    // settles — the service's side, not this runtime's.
    const controller = new AbortController();
    controller.abort();
    const { outcome } = await ask(makeRequest(cwd, controller.signal), fork.createQuery);

    assert.equal(fork.calls(), 0, 'a dismiss never retries');
    assert.equal(outcome.status, 'error');

    script.emit(result());
    script.end();
    await done;
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('a superseded run\'s late task-stopped notification does not release the run that replaced it', { concurrency: false }, async () => {
  // Pins review-fixes-2 item 1: `maybeReleasePromptStream` used to find the
  // activeSessions entry by session key alone, so a notification that
  // reaches the *stale* run after a new turn has taken the session over
  // released the *new* run's stdin instead of (at most) the stale run's own
  // already-resolved closer.
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'claude-side-question-hold-'));
  const first = createScriptedQuery();
  const second = createScriptedQuery();
  const writer = { send: () => {}, userId: null };

  try {
    const firstRun = queryClaudeSDK('start an agent', { sessionId: SESSION_ID, cwd }, writer as never, makeContext(first.createQuery));
    first.script.emit(init());
    first.script.emit(toolUse('toolu_agent', 'Agent', { prompt: 'sleep 90', subagent_type: 'general-purpose', run_in_background: true }));
    first.script.emit(taskStarted('a1', 'toolu_agent', 'local_agent'));
    first.script.emit(ack('toolu_agent', 'Async agent launched successfully.', { status: 'async_launched', agentId: 'a1' }));
    await emitAndFlush(first.script, result());
    // The result's own handling is confirmed above; a short extra pause
    // before the negative check below covers any async release path too.
    await settle();
    assert.equal(first.script.released(), false, 'the first process is held for its agent');

    // A new turn supersedes the held one directly: its process is let go at
    // once, and the map entry under the session key now belongs to it.
    const secondRun = queryClaudeSDK('continue', { sessionId: SESSION_ID, cwd }, writer as never, makeContext(second.createQuery));
    await waitFor(() => first.script.released());
    assert.equal(first.script.released(), true, 'the superseded process is let go');

    // The stale run's own stream is still open on its scripted side (nothing
    // called `first.script.end()` yet), so this notification — the agent's
    // real-world stop reply, arriving late — still reaches its loop.
    await emitAndFlush(first.script, taskNotification('a1', 'toolu_agent', 'stopped'));
    // Confirmed the stale run's own loop finished handling it; give any
    // (buggy) cross-session release a moment too before the negative check.
    await settle();
    assert.equal(second.script.released(), false, 'the new run\'s input is untouched by the stale run\'s own release check');

    first.script.end();
    await firstRun;
    second.script.emit(init());
    await emitAndFlush(second.script, result());
    await waitFor(() => second.script.released());
    assert.equal(second.script.released(), true, 'the new run still releases normally once its own turn ends');
    second.script.end();
    await secondRun;
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('a native side question answered on a superseded run does not touch the pending count of the run that replaced it', { concurrency: false }, async () => {
  // Pins review-fixes-2 item 2: `askSideQuestion`'s `finally` used to
  // decrement and release whichever entry the session key held *now*, so a
  // question asked on a run that was later superseded could decrement — and
  // wrongly release — the count the new run's own question was relying on.
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'claude-side-question-hold-'));
  let rejectFirstNative!: (error: unknown) => void;
  const { native: firstNative, called: firstNativeCalled } = trackCalls(
    () => new Promise((_resolve, reject) => { rejectFirstNative = reject; }),
  );
  let resolveSecondNative!: (value: unknown) => void;
  const { native: secondNative, called: secondNativeCalled } = trackCalls(
    () => new Promise((resolve) => { resolveSecondNative = resolve; }),
  );
  const first = createScriptedQuery(firstNative);
  const second = createScriptedQuery(secondNative);
  const fork = createForkQuery();
  const writer = { send: () => {}, userId: null };

  try {
    const firstRun = queryClaudeSDK('hello', { sessionId: SESSION_ID, cwd }, writer as never, makeContext(first.createQuery));
    await emitAndFlush(first.script, init());

    const firstController = new AbortController();
    const firstAsked = ask(makeRequest(cwd, firstController.signal), fork.createQuery);
    await waitFor(firstNativeCalled);

    // Supersede while the first question is still outstanding. The CLI
    // cancels it once its own process is let go, so `firstAsked` will settle
    // on the fork path below — exercising the `finally` this pins.
    const secondRun = queryClaudeSDK('continue', { sessionId: SESSION_ID, cwd }, writer as never, makeContext(second.createQuery));
    await waitFor(() => first.script.released());
    assert.equal(first.script.released(), true, 'the superseded process is let go');
    await emitAndFlush(second.script, init());

    // The new run gets its own native side question, still pending, and lets
    // its turn end — nothing else outstanding, so the hold is purely this
    // question's count and its own `releaseDeferred`.
    const secondController = new AbortController();
    const secondAsked = ask(makeRequest(cwd, secondController.signal), fork.createQuery);
    await waitFor(secondNativeCalled);
    await emitAndFlush(second.script, result());
    // Confirmed the result's own handling ran; a short extra pause covers
    // any (buggy) async release before this negative check.
    await settle();
    assert.equal(second.script.released(), false, 'the second run\'s own pending question keeps its stdin open');

    // The first question's native call finally rejects as cancelled (its
    // process already let go). Its own `finally` must not touch the second
    // run's entry: that would drop the second run's count to zero and
    // release it while its own question is still outstanding.
    rejectFirstNative(new Error('Side question cancelled'));
    const { outcome: firstOutcome } = await firstAsked;
    assert.equal(fork.calls(), 1, 'the cancelled first question is retried on the fork');
    assert.deepEqual(firstOutcome, { status: 'done', answer: FORK_ANSWER });
    // `firstAsked` already settled, so the `finally` this pins has already
    // run; a short extra pause covers any further async effects of it
    // before this negative check.
    await settle();
    assert.equal(second.script.released(), false, 'the second run\'s own pending question still holds its stdin');

    resolveSecondNative({ response: NATIVE_ANSWER, synthetic: false });
    const { outcome: secondOutcome } = await secondAsked;
    assert.deepEqual(secondOutcome, { status: 'done', answer: NATIVE_ANSWER });
    await waitFor(() => second.script.released());

    first.script.end();
    await firstRun;
    second.script.end();
    await secondRun;
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('a native side question the CLI never answers still releases once the idle ceiling passes', { concurrency: false }, async (t) => {
  // Pins review-fixes-2 item 3: the backstop. The idle ceiling
  // (`BG_WAIT_CEILING_MS` in the runtime file, not exported — 30 minutes) is
  // re-armed every time a release is deferred for a pending native question,
  // and forces the release through once it passes, so a question the CLI
  // never answers cannot hold the process (and its MCP servers) forever.
  t.mock.timers.enable({ apis: ['setTimeout'] });
  // `setTimeout` is mocked above, so sequencing below cannot poll with it —
  // `waitForImmediate` drains the scripted query's async chain (a promise
  // `wake()` resolves, read by the `for await` loop, normalized, and so on)
  // with real `setImmediate` rounds instead, polling an actual predicate
  // rather than guessing a fixed number of rounds the way the old fixed
  // 10-round `flush()` did.
  async function waitForImmediate(
    condition: () => boolean,
    { maxRounds = 2000 }: { maxRounds?: number } = {},
  ): Promise<void> {
    for (let round = 0; round < maxRounds && !condition(); round += 1) {
      await new Promise<void>((resolve) => { setImmediate(resolve); });
    }
    assert.ok(condition(), `condition never became true within ${maxRounds} setImmediate rounds`);
  }

  const cwd = await mkdtemp(path.join(os.tmpdir(), 'claude-side-question-hold-'));
  const { native, called: nativeCalled } = trackCalls(() => new Promise(() => { /* never settles */ }));
  const { createQuery, script } = createScriptedQuery(native);
  const fork = createForkQuery();
  const writer = { send: () => {}, userId: null };

  try {
    const done = queryClaudeSDK('hello', { sessionId: SESSION_ID, cwd }, writer as never, makeContext(createQuery));
    script.emit(init());
    await waitForImmediate(() => script.consumed() >= 1);

    const controller = new AbortController();
    void ask(makeRequest(cwd, controller.signal), fork.createQuery);

    script.emit(result());
    // Wait until the side question has reached the native stub *and* the
    // turn has ended, before advancing the mocked clock — otherwise ticking
    // the ceiling could land before there is anything pending to force.
    await waitForImmediate(() => nativeCalled() && script.consumed() >= 2);
    assert.equal(script.released(), false, 'the hung question keeps stdin open past the turn\'s own result');

    t.mock.timers.tick(30 * 60 * 1000);
    await waitForImmediate(() => script.released());
    assert.equal(script.released(), true, 'the idle ceiling forces the release even though the question never settled');

    script.end();
    await done;
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
