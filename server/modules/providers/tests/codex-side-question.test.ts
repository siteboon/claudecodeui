import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { codexAppServer } from '@/modules/providers/list/codex/codex-app-server.client.js';
import { codexRuntime } from '@/modules/providers/list/codex/codex-runtime.provider.js';
import type { ProviderRuntimeContext, SideQuestionOutcome, SideQuestionRequest } from '@/shared/types.js';
import {
  SIDE_CONVERSATION_BOUNDARY_PROMPT,
  SIDE_CONVERSATION_DEVELOPER_INSTRUCTIONS,
} from '@/shared/utils.js';

/**
 * A Codex side question is an ephemeral, read-only `thread/fork` with Codex's
 * own side-conversation instructions, plus one `turn/start` on the fork. These
 * run `codexAppServer.askSideQuestion` against a fake app-server — a node
 * script speaking newline-delimited JSON-RPC that records every line it
 * receives — installed through `codexAppServer.resolveLauncher`, so no real
 * Codex binary ever starts.
 *
 * Shapes follow the protocol generated from Codex 0.156.1
 * (`v2/ThreadForkParams`, `TurnStartParams`, `AgentMessageDeltaNotification`,
 * `TurnCompletedNotification`, `ServerRequest`).
 */

const PARENT_THREAD = 'thread-parent-1';
const FORK_THREAD = 'thread-fork-1';
const TURN_ID = 'turn-1';
const QUESTION = 'Which file holds the router?';

type AskInput = { threadId: string; cwd: string; model: string; question: string; signal: AbortSignal };
type AppServerSideQuestion = {
  resolveLauncher?: () => string;
  askSideQuestion?: (input: AskInput, onDelta: (text: string) => void) => Promise<string>;
};
type RuntimeSideQuestion = {
  askSideQuestion?: (
    request: SideQuestionRequest,
    sink: { delta(text: string): void },
    context: ProviderRuntimeContext,
  ) => Promise<SideQuestionOutcome>;
};

const appServer = codexAppServer as unknown as AppServerSideQuestion;
const runtime = codexRuntime as unknown as RuntimeSideQuestion;

type Mode = 'complete' | 'failed' | 'fork-error' | 'hang' | 'server-request';

/**
 * The fake app-server. `mode` decides how the turn goes; everything received
 * is appended to `log` as one JSON line, and the pid lands in `pidFile` so the
 * abort test can check the child is gone. A self-destruct keeps a broken
 * implementation from leaving it running.
 */
function fakeAppServerSource(mode: Mode, log: string, pidFile: string): string {
  return `
const fs = require('node:fs');
const readline = require('node:readline');
const MODE = ${JSON.stringify(mode)};
const LOG = ${JSON.stringify(log)};
fs.writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
setTimeout(() => process.exit(0), 15000);
const send = (message) => process.stdout.write(JSON.stringify(message) + '\\n');
const notify = (method, params) => send({ jsonrpc: '2.0', method, params });
const delta = (threadId, text) => notify('item/agentMessage/delta', { threadId, turnId: ${JSON.stringify(TURN_ID)}, itemId: 'msg-1', delta: text });
const turn = (status, error) => ({ id: ${JSON.stringify(TURN_ID)}, items: [], itemsView: 'full', status, error, startedAt: null, completedAt: null });
const FORK = ${JSON.stringify(FORK_THREAD)};
let serverRequestId = null;

function runTurn() {
  if (MODE === 'hang') {
    delta(FORK, 'Partial');
    setInterval(() => {}, 1000);
    return;
  }
  if (MODE === 'failed') {
    delta(FORK, 'partial ');
    notify('turn/completed', { threadId: FORK, turn: turn('failed', { message: 'model overloaded', codexErrorInfo: null, additionalDetails: null, misalignment: null }) });
    return;
  }
  delta(FORK, 'The router ');
  delta('thread-other', 'NOT THIS THREAD');
  delta(FORK, 'is in ');
  delta(FORK, 'src/router.ts.');
  notify('turn/completed', { threadId: FORK, turn: turn('completed', null) });
}

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  if (!line.trim()) return;
  const message = JSON.parse(line);
  fs.appendFileSync(LOG, JSON.stringify(message) + '\\n');

  if (serverRequestId !== null && message.id === serverRequestId && !message.method) {
    // The client answered our server request; only now does turn/start get its reply.
    serverRequestId = null;
    send({ jsonrpc: '2.0', id: message.id, result: { turn: turn('inProgress', null) } });
    notify('turn/started', { threadId: FORK, turn: turn('inProgress', null) });
    runTurn();
    return;
  }

  if (message.method === 'initialize') {
    send({ jsonrpc: '2.0', id: message.id, result: { userAgent: 'fake-codex/0.156.1' } });
  } else if (message.method === 'thread/fork') {
    if (MODE === 'fork-error') {
      send({ jsonrpc: '2.0', id: message.id, error: { code: -32600, message: 'thread not found: ${PARENT_THREAD}' } });
      return;
    }
    send({ jsonrpc: '2.0', id: message.id, result: { thread: { id: FORK, path: null, ephemeral: true }, model: 'gpt-5.6', cwd: '/' } });
  } else if (message.method === 'turn/start') {
    if (MODE === 'server-request') {
      // A server request whose id collides with the pending turn/start id.
      serverRequestId = message.id;
      send({ jsonrpc: '2.0', id: message.id, method: 'item/tool/requestUserInput', params: { threadId: FORK, turnId: ${JSON.stringify(TURN_ID)}, itemId: 'tool-1', questions: [] } });
      return;
    }
    send({ jsonrpc: '2.0', id: message.id, result: { turn: turn('inProgress', null) } });
    notify('turn/started', { threadId: FORK, turn: turn('inProgress', null) });
    runTurn();
  }
});
`;
}

type Fake = { dir: string; log: string; pidFile: string; received: () => Promise<Array<Record<string, any>>> };

async function withFakeAppServer(mode: Mode, runTest: (fake: Fake) => Promise<void>): Promise<void> {
  assert.equal(typeof appServer.resolveLauncher, 'function', 'codexAppServer.resolveLauncher is missing (contract-server: the launcher seam)');
  assert.equal(typeof appServer.askSideQuestion, 'function', 'codexAppServer.askSideQuestion is missing (contract-server)');

  const dir = await mkdtemp(path.join(os.tmpdir(), 'codex-side-question-'));
  const log = path.join(dir, 'received.jsonl');
  const pidFile = path.join(dir, 'pid');
  const script = path.join(dir, 'fake-app-server.cjs');
  await writeFile(script, fakeAppServerSource(mode, log, pidFile), 'utf8');
  await writeFile(log, '', 'utf8');

  const original = appServer.resolveLauncher;
  appServer.resolveLauncher = () => script;
  const received = async () => (await readFile(log, 'utf8'))
    .split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line) as Record<string, any>);

  try {
    await runTest({ dir, log, pidFile, received });
  } finally {
    appServer.resolveLauncher = original;
    await rm(dir, { recursive: true, force: true });
  }
}

const askInput = (overrides: Partial<AskInput> = {}): AskInput => ({
  threadId: PARENT_THREAD,
  cwd: '/work/project',
  model: 'gpt-5.6',
  question: QUESTION,
  signal: new AbortController().signal,
  ...overrides,
});

const settle = () => new Promise((resolve) => { setTimeout(resolve, 25); });

test('the fork is ephemeral, read-only and carries the side-conversation instructions', { concurrency: false }, async () => {
  await withFakeAppServer('complete', async ({ received }) => {
    await appServer.askSideQuestion!(askInput(), () => {});
    const lines = await received();

    assert.deepEqual(lines.slice(0, 3).map((line) => line.method), ['initialize', 'initialized', 'thread/fork']);
    const fork = lines.find((line) => line.method === 'thread/fork');
    assert.deepEqual(fork?.params, {
      threadId: PARENT_THREAD,
      cwd: '/work/project',
      model: 'gpt-5.6',
      ephemeral: true,
      sandbox: 'read-only',
      approvalPolicy: 'never',
      developerInstructions: SIDE_CONVERSATION_DEVELOPER_INSTRUCTIONS,
      excludeTurns: true,
    });
  });
});

test('an empty cwd or model is left out of the fork', { concurrency: false }, async () => {
  await withFakeAppServer('complete', async ({ received }) => {
    await appServer.askSideQuestion!(askInput({ cwd: '', model: '' }), () => {});
    const fork = (await received()).find((line) => line.method === 'thread/fork');
    assert.ok(fork, 'thread/fork was sent');
    assert.equal('cwd' in fork.params, false);
    assert.equal('model' in fork.params, false);
  });
});

test('the turn starts on the fork\'s thread with the boundary prompt and then the question', { concurrency: false }, async () => {
  await withFakeAppServer('complete', async ({ received }) => {
    await appServer.askSideQuestion!(askInput(), () => {});
    const turnStart = (await received()).find((line) => line.method === 'turn/start');
    assert.ok(turnStart, 'turn/start was sent');
    assert.equal(turnStart.params.threadId, FORK_THREAD);
    assert.deepEqual(turnStart.params.input, [
      { type: 'text', text: SIDE_CONVERSATION_BOUNDARY_PROMPT, text_elements: [] },
      { type: 'text', text: QUESTION, text_elements: [] },
    ]);
  });
});

test('deltas for the fork are forwarded in order and the answer resolves after turn/completed', { concurrency: false }, async () => {
  await withFakeAppServer('complete', async () => {
    const deltas: string[] = [];
    const answer = await appServer.askSideQuestion!(askInput(), (text) => { deltas.push(text); });
    assert.deepEqual(deltas, ['The router ', 'is in ', 'src/router.ts.'], 'another thread\'s delta is not forwarded');
    assert.equal(answer, 'The router is in src/router.ts.');
  });
});

test('a failed turn rejects with the turn\'s error message', { concurrency: false }, async () => {
  await withFakeAppServer('failed', async () => {
    await assert.rejects(appServer.askSideQuestion!(askInput(), () => {}), /model overloaded/);
  });
});

test('a JSON-RPC error rejects with its message', { concurrency: false }, async () => {
  await withFakeAppServer('fork-error', async () => {
    await assert.rejects(appServer.askSideQuestion!(askInput(), () => {}), /thread not found/);
  });
});

test('an aborted signal kills the child and rejects', { concurrency: false }, async () => {
  await withFakeAppServer('hang', async ({ pidFile }) => {
    const controller = new AbortController();
    let sawDelta = false;
    const pending = appServer.askSideQuestion!(askInput({ signal: controller.signal }), () => { sawDelta = true; });
    for (let attempt = 0; attempt < 200 && !sawDelta; attempt += 1) {
      await settle();
    }
    assert.ok(sawDelta, 'the turn was under way before the abort');
    const pid = Number(await readFile(pidFile, 'utf8'));

    controller.abort();
    await assert.rejects(pending);

    let alive = true;
    for (let attempt = 0; attempt < 80 && alive; attempt += 1) {
      try { process.kill(pid, 0); await settle(); } catch { alive = false; }
    }
    assert.equal(alive, false, 'the app-server child is gone after the abort');
  });
});

test('a server request mid-turn is answered with a JSON-RPC error and does not settle turn/start', { concurrency: false }, async () => {
  await withFakeAppServer('server-request', async ({ received }) => {
    const deltas: string[] = [];
    const answer = await appServer.askSideQuestion!(askInput(), (text) => { deltas.push(text); });

    const lines = await received();
    const turnStart = lines.find((line) => line.method === 'turn/start');
    assert.ok(turnStart, 'turn/start was sent');
    const reply = lines.find((line) => line.id === turnStart.id && !line.method);
    assert.ok(reply, 'the client answered the server request');
    assert.ok(reply.error && typeof reply.error.message === 'string', 'with a JSON-RPC error');
    assert.equal('result' in reply, false);
    assert.equal(answer, 'The router is in src/router.ts.', 'the turn still completes');
    assert.deepEqual(deltas, ['The router ', 'is in ', 'src/router.ts.']);
  });
});

// codexRuntime.askSideQuestion maps a SideQuestionRequest onto the client.
// The client itself is replaced here, so nothing is spawned.

const context = {} as ProviderRuntimeContext;

const request = (overrides: Partial<SideQuestionRequest> = {}): SideQuestionRequest => ({
  appSessionId: 'app-codex-session',
  providerSessionId: PARENT_THREAD,
  projectPath: '/work/project',
  question: QUESTION,
  model: 'gpt-5.6',
  signal: new AbortController().signal,
  ...overrides,
});

async function withStubbedClient(
  stub: NonNullable<AppServerSideQuestion['askSideQuestion']>,
  runTest: () => Promise<void>,
): Promise<void> {
  assert.equal(typeof runtime.askSideQuestion, 'function', 'codexRuntime.askSideQuestion is missing (contract-server)');
  const original = appServer.askSideQuestion;
  appServer.askSideQuestion = stub;
  try {
    await runTest();
  } finally {
    appServer.askSideQuestion = original;
  }
}

test('codexRuntime asks on the session\'s thread, project and model, and streams to the sink', { concurrency: false }, async () => {
  const inputs: AskInput[] = [];
  await withStubbedClient(async (input, onDelta) => {
    inputs.push(input);
    onDelta('Hel');
    onDelta('lo');
    return 'Hello';
  }, async () => {
    const deltas: string[] = [];
    const sideRequest = request();
    const outcome = await runtime.askSideQuestion!(sideRequest, { delta: (text) => { deltas.push(text); } }, context);

    assert.equal(inputs.length, 1);
    assert.equal(inputs[0]?.threadId, PARENT_THREAD);
    assert.equal(inputs[0]?.cwd, '/work/project');
    assert.equal(inputs[0]?.model, 'gpt-5.6');
    assert.equal(inputs[0]?.question, QUESTION);
    assert.equal(inputs[0]?.signal, sideRequest.signal);
    assert.deepEqual(deltas, ['Hel', 'lo']);
    assert.deepEqual(outcome, { status: 'done', answer: 'Hello' });
  });
});

test('codexRuntime without a provider session id is an error outcome and asks nothing', { concurrency: false }, async () => {
  let called = false;
  await withStubbedClient(async () => { called = true; return 'unused'; }, async () => {
    const outcome = await runtime.askSideQuestion!(request({ providerSessionId: null }), { delta: () => {} }, context);
    assert.equal(outcome.status, 'error');
    assert.equal(called, false);
  });
});

test('codexRuntime turns a rejected ask into an error outcome, never a throw', { concurrency: false }, async () => {
  await withStubbedClient(async (_input, onDelta) => {
    onDelta('partial');
    throw new Error('model overloaded');
  }, async () => {
    const outcome = await runtime.askSideQuestion!(request(), { delta: () => {} }, context);
    assert.equal(outcome.status, 'error');
    assert.match(outcome.status === 'error' ? outcome.error : '', /model overloaded/);
  });
});
