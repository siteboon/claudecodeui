import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ClaudeSessionsProvider } from '@/modules/providers/list/claude/claude-sessions.provider.js';
import { CLAUDE_PREDEFINED_MODELS } from '@/modules/providers/list/claude/claude-models.provider.js';
import {
  queryClaudeSDK,
  steerClaudeSDKSession,
} from '@/modules/providers/list/claude/claude-runtime.provider.js';
import type { NormalizedMessage, ProviderRuntimeContext } from '@/shared/types.js';

/**
 * `steerClaudeSDKSession` pushes a record onto the exact same held-stdin
 * stream the run loop is already reading, so the CLI sees it exactly like the
 * initial prompt. These drive `queryClaudeSDK` with a scripted SDK stream —
 * the seam is `context.createQuery` — that records every record it reads off
 * the prompt iterable ("stdin"), and prove: the pushed record actually
 * reaches it, the turn's `complete` is withheld while the fold is
 * unconfirmed, and a session with no live process refuses to steer.
 */

const SESSION_ID = 'app-steer-session';
const NATIVE_ID = 'native-steer-session';

type Scripted = {
  emit: (message: Record<string, unknown>) => void;
  end: () => void;
  released: () => boolean;
  stdin: unknown[];
};

/** A stand-in for the SDK query: yields what the test emits, and records everything it reads off the prompt iterable. */
function createScriptedQuery(): { createQuery: NonNullable<ProviderRuntimeContext['createQuery']>; script: Scripted } {
  const queue: Array<Record<string, unknown> | null> = [];
  let wake: (() => void) | null = null;
  let released = false;
  const stdin: unknown[] = [];

  const script: Scripted = {
    emit: (message) => { queue.push(message); wake?.(); },
    end: () => { queue.push(null); wake?.(); },
    released: () => released,
    stdin,
  };

  const createQuery: NonNullable<ProviderRuntimeContext['createQuery']> = ({ prompt }) => {
    void (async () => {
      for await (const message of prompt) {
        stdin.push(message);
      }
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
      }
    })();

    return Object.assign(iterator, {
      interrupt: async () => {},
      stopTask: async (_taskId: string) => {},
    });
  };

  return { createQuery, script };
}

/**
 * Polls instead of sleeping a fixed duration — this machine's first spawn
 * through `queryClaudeSDK` (reading `~/.claude.json`, ~92 KB here) is slow
 * enough that a fixed 25 ms settle flakes.
 */
async function waitFor(condition: () => boolean, what: string, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timed out waiting for: ${what}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/**
 * No observable condition distinguishes "the result was processed and
 * nothing was sent" from "the result has not been processed yet" — there is
 * nothing to poll for an absence. By this point in each test the slow,
 * variable-latency work (the `~/.claude.json` read) is long done, so a couple
 * of macrotask turns are enough for the scripted CLI's promise chain to run.
 */
const flushMicrotasks = () => new Promise((resolve) => setImmediate(resolve))
  .then(() => new Promise((resolve) => setImmediate(resolve)));

async function withRun(
  runTest: (context: { script: Scripted; sent: NormalizedMessage[]; cwd: string; done: Promise<unknown> }) => Promise<void>,
): Promise<void> {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'claude-runtime-steer-'));
  const { createQuery, script } = createScriptedQuery();
  const sent: NormalizedMessage[] = [];
  const writer = { send: (message: NormalizedMessage) => { sent.push(message); }, userId: null };
  const sessions = new ClaudeSessionsProvider({ getLiveRunStartTime: () => null });
  const context: ProviderRuntimeContext = {
    resolveProviderSessionId: () => null,
    resolveResumeModel: async () => undefined,
    getProviderModels: async () => CLAUDE_PREDEFINED_MODELS as never,
    normalizeMessage: (raw, sessionId) => sessions.normalizeMessage(raw, sessionId),
    isProviderInstalled: async () => true,
    createQuery,
  };

  try {
    const done = queryClaudeSDK('hello', { sessionId: SESSION_ID, cwd }, writer as never, context);
    await runTest({ script, sent, cwd, done });
    script.end();
    await done;
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

const init = () => ({ type: 'system', subtype: 'init', session_id: NATIVE_ID });
const result = () => ({ type: 'result', subtype: 'success', session_id: NATIVE_ID, result: 'done', duration_ms: 1, num_turns: 1 });

// Reproduces the background-work hold from claude-runtime-hold.test.ts: a
// Workflow tool call that launches async, so the turn's `result` both
// completes the turn for the client AND holds the process open for it.
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

test('a steered message reaches the running turn\'s stdin and defers complete until the fold is accounted for', async () => {
  await withRun(async ({ script, sent, cwd }) => {
    script.emit(init());
    await waitFor(() => script.stdin.length >= 1, 'the initial prompt to reach stdin');

    const steered = await steerClaudeSDKSession(SESSION_ID, 'also do X', { cwd });
    assert.ok(steered, 'steer is accepted while the run is active');
    const { uuid } = steered as { uuid: string };

    await waitFor(() => script.stdin.length >= 2, 'the steered record to reach stdin');
    const pushedRecord = script.stdin[1] as Record<string, unknown>;
    assert.equal(pushedRecord.type, 'user');
    assert.equal(pushedRecord.uuid, uuid);
    const content = (pushedRecord.message as Record<string, unknown>).content;
    assert.ok(String(content).includes('also do X'));
    assert.equal(script.released(), false, 'stdin stays open — the fold has not been confirmed');

    // The CLI never folds it mid-turn in this script (no `user_message_uuid`
    // echo), so the CLI is about to run it as a turn of its own — this
    // `result` must not complete the turn for the client yet.
    script.emit(result());
    await flushMicrotasks();
    assert.equal(sent.some((message) => message.kind === 'complete'), false, 'complete is withheld while the steer is unconfirmed');

    // The follow-up turn the CLI is guaranteed to push for the dropped steer.
    script.emit(result());
    await waitFor(() => sent.some((message) => message.kind === 'complete'), 'the deferred complete');
    assert.equal(sent.filter((message) => message.kind === 'complete').length, 1, 'complete is sent exactly once');
  });
});

test('two steers folded at the same tool boundary both settle off one assistant frame', async () => {
  await withRun(async ({ script, sent, cwd }) => {
    script.emit(init());
    await waitFor(() => script.stdin.length >= 1, 'the initial prompt to reach stdin');

    const first = await steerClaudeSDKSession(SESSION_ID, 'do X', { cwd });
    const second = await steerClaudeSDKSession(SESSION_ID, 'also do Y', { cwd });
    assert.ok(first, 'first steer is accepted while the run is active');
    assert.ok(second, 'second steer is accepted while the run is active');
    const { uuid: uuid1 } = first as { uuid: string };
    const { uuid: uuid2 } = second as { uuid: string };

    await waitFor(() => script.stdin.length >= 3, 'both steered records to reach stdin');

    // The real CLI stamps exactly one `user_message_uuid` per assistant
    // frame but lists every folded uuid in `user_message_uuids` when more
    // than one steer lands at the same tool boundary.
    script.emit({
      type: 'assistant',
      session_id: NATIVE_ID,
      user_message_uuid: uuid1,
      user_message_uuids: [uuid1, uuid2],
      message: { role: 'assistant', content: [{ type: 'text', text: 'working on it' }] },
    });
    await flushMicrotasks();

    script.emit(result());
    await waitFor(() => sent.some((message) => message.kind === 'complete'), 'complete sent immediately, not deferred');
    assert.equal(sent.filter((message) => message.kind === 'complete').length, 1, 'complete is sent exactly once');
  });
});

test('steering a session with no live process is refused', async () => {
  await withRun(async ({ script }) => {
    script.emit(init());
    script.emit(result());
    await flushMicrotasks();
  });

  // `withRun` already closed stdin and awaited the run to completion, which
  // removes the session — nothing is left to push a steered message onto.
  const steered = await steerClaudeSDKSession(SESSION_ID, 'too late', {});
  assert.equal(steered, null);
});

test('a steer confirmed via user_message_uuid on the assistant frame settles on the first result, not deferred', async () => {
  await withRun(async ({ script, sent, cwd }) => {
    script.emit(init());
    await waitFor(() => script.stdin.length >= 1, 'the initial prompt to reach stdin');

    const steered = await steerClaudeSDKSession(SESSION_ID, 'also do X', { cwd });
    assert.ok(steered, 'steer is accepted while the run is active');

    await waitFor(() => script.stdin.length >= 2, 'the steered record to reach stdin');
    // Read the uuid off the record the fake CLI actually consumed, rather
    // than trusting the one steerClaudeSDKSession returned, so the test
    // proves the fold is matched against what the CLI saw.
    const pushedRecord = script.stdin[1] as Record<string, unknown>;
    const pushedUuid = pushedRecord.uuid as string;
    assert.ok(pushedUuid, 'the pushed record carries a uuid');

    script.emit({
      type: 'assistant',
      session_id: NATIVE_ID,
      user_message_uuid: pushedUuid,
      message: { role: 'assistant', content: [{ type: 'text', text: 'working on it' }] },
    });
    await flushMicrotasks();

    script.emit(result());
    await waitFor(() => sent.some((message) => message.kind === 'complete'), 'complete sent on the first result');
    assert.equal(sent.filter((message) => message.kind === 'complete').length, 1, 'complete is sent exactly once');
  });
});

test('a steer confirmed via the marker-based synthetic user echo settles on the first result, not deferred', async () => {
  await withRun(async ({ script, sent, cwd }) => {
    script.emit(init());
    await waitFor(() => script.stdin.length >= 1, 'the initial prompt to reach stdin');

    const steered = await steerClaudeSDKSession(SESSION_ID, 'also do X', { cwd });
    assert.ok(steered, 'steer is accepted while the run is active');
    await waitFor(() => script.stdin.length >= 2, 'the steered record to reach stdin');

    // Newer CLIs (2.1.x / SDK >=0.3.275's bundled binary) confirm the fold by
    // surfacing the folded message back to the model as a synthetic `user`
    // turn wrapped in a system-reminder banner, instead of (or in addition
    // to) stamping `user_message_uuid` on the assistant frame. No uuid at
    // all here — the detector has to match on the echoed prompt text.
    script.emit({
      type: 'user',
      session_id: NATIVE_ID,
      parent_tool_use_id: null,
      message: {
        role: 'user',
        content: '<system-reminder>\nThe user sent a new message while you were working: also do X\n</system-reminder>',
      },
    });
    await flushMicrotasks();

    script.emit(result());
    await waitFor(() => sent.some((message) => message.kind === 'complete'), 'complete sent on the first result');
    assert.equal(sent.filter((message) => message.kind === 'complete').length, 1, 'complete is sent exactly once');
  });
});

test('a session held open for background work after its result refuses to steer', async () => {
  await withRun(async ({ script, sent, cwd }) => {
    script.emit(init());
    await waitFor(() => script.stdin.length >= 1, 'the initial prompt to reach stdin');

    // A Workflow tool call that launches async — same shape as
    // claude-runtime-hold.test.ts's "stopping the last outstanding task"
    // case — so the turn's `result` both completes the turn for the client
    // AND holds the process open for the still-outstanding task.
    script.emit(toolUse('toolu_wf', 'Workflow', { script: 'export const meta = {}' }));
    script.emit(taskStarted('wf1', 'toolu_wf', 'local_workflow'));
    script.emit(ack('toolu_wf', 'Workflow launched in background. Task ID: wf1', { status: 'async_launched', taskId: 'wf1', taskType: 'local_workflow' }));
    script.emit(result());
    await waitFor(() => sent.some((message) => message.kind === 'complete'), 'the turn completes for the client');
    assert.equal(script.released(), false, 'stdin stays open — the process is held for the outstanding task');

    // The turn is over; the process is only alive for background work now.
    // Steering it must not fold a message into a run the client already
    // believes is finished.
    const steered = await steerClaudeSDKSession(SESSION_ID, 'too late, held for background work', { cwd });
    assert.equal(steered, null, 'steering a turn-completed, held-open session is refused');
    assert.equal(script.stdin.length, 1, 'nothing beyond the initial prompt reached stdin');
    assert.equal(sent.filter((message) => message.kind === 'complete').length, 1, 'still exactly one complete — no second terminal event was triggered by the refused steer');
  });
});

test('a late message from a superseded run does not settle or clear the superseding run\'s pending steer', async () => {
  // `chat.send { interrupt: true }` (chat-websocket.service.ts's
  // abortRunningRun + dispatchRun) replaces an in-flight turn with a new run
  // on the SAME app session id. `addSession` sees a different live instance
  // under that key and supersedes the old entry, interrupting it
  // asynchronously — but the old run's own generator keeps yielding whatever
  // the fake CLI already queued, same as a real process winding down instead
  // of dying instantly. Any message it emits after that point must not reach
  // into the entry that now belongs to the new run.
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'claude-runtime-steer-supersede-'));
  try {
    const runA = createScriptedQuery();
    const runB = createScriptedQuery();
    const sentA: NormalizedMessage[] = [];
    const sentB: NormalizedMessage[] = [];
    const writerA = { send: (message: NormalizedMessage) => { sentA.push(message); }, userId: null };
    const writerB = { send: (message: NormalizedMessage) => { sentB.push(message); }, userId: null };
    const sessions = new ClaudeSessionsProvider({ getLiveRunStartTime: () => null });
    const makeContext = (createQuery: NonNullable<ProviderRuntimeContext['createQuery']>): ProviderRuntimeContext => ({
      resolveProviderSessionId: () => null,
      resolveResumeModel: async () => undefined,
      getProviderModels: async () => CLAUDE_PREDEFINED_MODELS as never,
      normalizeMessage: (raw, sessionId) => sessions.normalizeMessage(raw, sessionId),
      isProviderInstalled: async () => true,
      createQuery,
    });

    // Run A starts and registers the session entry.
    const doneA = queryClaudeSDK('hello', { sessionId: SESSION_ID, cwd }, writerA as never, makeContext(runA.createQuery));
    runA.script.emit(init());
    await waitFor(() => runA.script.stdin.length >= 1, 'run A\'s initial prompt to reach stdin');

    // Run B starts on the same app session id and supersedes run A.
    const doneB = queryClaudeSDK('replace it', { sessionId: SESSION_ID, cwd }, writerB as never, makeContext(runB.createQuery));
    runB.script.emit(init());
    await waitFor(() => runB.script.stdin.length >= 1, 'run B\'s initial prompt to reach stdin');

    // Run B registers a real pending steer of its own — unconfirmed, same as
    // this file's very first test.
    const steered = await steerClaudeSDKSession(SESSION_ID, 'do this in run B', { cwd });
    assert.ok(steered, 'run B is the live, steerable session now');
    await waitFor(() => runB.script.stdin.length >= 2, 'run B\'s steered record to reach stdin');

    // Run A (superseded, but still draining what its own scripted stream
    // already queued) reports a `result` of its own late.
    runA.script.emit(result());
    await flushMicrotasks();

    // Run B's own first `result` — with nothing having confirmed its steer's
    // fold, this must defer `complete` by one extra result, exactly like the
    // unconfirmed-steer case in this file's first test. Before the fix, run
    // A's late result read/cleared run B's `pendingSteers` (both were fetched
    // via the same unguarded `getSession(sessionKey())`), so run B's result
    // found nothing pending and completed immediately instead.
    runB.script.emit(result());
    await flushMicrotasks();
    assert.equal(sentB.some((message) => message.kind === 'complete'), false, 'run A\'s late result must not have cleared run B\'s pending steer');

    // The follow-up turn the CLI is guaranteed to push for the dropped steer.
    runB.script.emit(result());
    await waitFor(() => sentB.some((message) => message.kind === 'complete'), 'run B\'s deferred complete');
    assert.equal(sentB.filter((message) => message.kind === 'complete').length, 1, 'run B completes exactly once');

    runA.script.end();
    runB.script.end();
    await doneA;
    await doneB;
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
