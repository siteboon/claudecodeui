import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import test from 'node:test';

import { codexRuntime } from '@/modules/providers/list/codex/codex-runtime.provider.js';
import { CodexSessionsProvider } from '@/modules/providers/list/codex/codex-sessions.provider.js';
import type { AnyRecord, ProviderRuntimeContext } from '@/shared/index.js';

/**
 * Codex chat turns run over `codex app-server`. These drive the runtime with a
 * scripted child — the seam is `context.spawnCodexAppServer` — that answers
 * the JSON-RPC requests the runtime sends and pushes the notifications a real
 * server would, so steering, interrupting and approvals can be checked
 * without the CLI or a model.
 */

const THREAD_ID = 'thread-1';
const TURN_ID = 'turn-1';

type ScriptedServer = {
  /** Every message the runtime wrote to the child's stdin, in order. */
  received: AnyRecord[];
  send: (message: AnyRecord) => void;
  notify: (method: string, params: AnyRecord) => void;
  /** Resolves with the first received message matching the predicate. */
  waitFor: (predicate: (message: AnyRecord) => boolean) => Promise<AnyRecord>;
  crash: () => void;
  killed: () => boolean;
};

/**
 * A stand-in for the app-server child. `answer` decides the reply to each
 * request; returning undefined leaves it to the test (via `send`).
 */
function createScriptedAppServer(
  answer: (message: AnyRecord, server: ScriptedServer) => AnyRecord | undefined = defaultAnswer,
) {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const child = new EventEmitter() as EventEmitter & AnyRecord;
  let killed = false;
  const waiters: Array<{ predicate: (message: AnyRecord) => boolean; resolve: (message: AnyRecord) => void }> = [];

  const server: ScriptedServer = {
    received: [],
    send: (message) => {
      if (!killed) stdout.write(`${JSON.stringify(message)}\n`);
    },
    notify: (method, params) => server.send({ method, params }),
    waitFor: (predicate) => new Promise((resolve) => {
      const found = server.received.find(predicate);
      if (found) {
        resolve(found);
        return;
      }
      waiters.push({ predicate, resolve });
    }),
    crash: () => {
      killed = true;
      child.emit('exit', 1, null);
    },
    killed: () => killed,
  };

  let buffer = '';
  child.stdin = new Writable({
    write(chunk, _encoding, callback) {
      buffer += String(chunk);
      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf('\n');
        const message = JSON.parse(line) as AnyRecord;
        server.received.push(message);
        for (const waiter of [...waiters]) {
          if (waiter.predicate(message)) {
            waiters.splice(waiters.indexOf(waiter), 1);
            waiter.resolve(message);
          }
        }
        if (message.method && message.id !== undefined) {
          const result = answer(message, server);
          if (result !== undefined) {
            server.send({ id: message.id, result });
          }
        }
      }
      callback();
    },
  });
  child.stdout = stdout;
  child.stderr = stderr;
  child.kill = () => {
    if (!killed) {
      killed = true;
      setImmediate(() => child.emit('exit', null, 'SIGTERM'));
    }
    return true;
  };

  return { spawnChild: () => child as never, server };
}

function defaultAnswer(message: AnyRecord, server: ScriptedServer): AnyRecord | undefined {
  switch (message.method) {
    case 'initialize':
      return { userAgent: 'test' };
    case 'thread/start':
      return { thread: { id: THREAD_ID } };
    case 'thread/resume':
      return { thread: { id: message.params.threadId } };
    case 'turn/start':
      setImmediate(() => server.notify('turn/started', { threadId: THREAD_ID, turn: { id: TURN_ID, status: 'inProgress' } }));
      return { turn: { id: TURN_ID, status: 'inProgress' } };
    case 'turn/steer':
      return { turnId: message.params.expectedTurnId };
    case 'turn/interrupt':
      setImmediate(() => server.notify('turn/completed', { threadId: THREAD_ID, turn: { id: TURN_ID, status: 'interrupted' } }));
      return {};
    default:
      return {};
  }
}

const sessions = new CodexSessionsProvider();

function createContext(spawnChild: () => never, resumeId: string | null = null): ProviderRuntimeContext {
  return {
    resolveProviderSessionId: () => resumeId,
    resolveResumeModel: async () => 'test-model',
    getProviderModels: async () => ({
      OPTIONS: [{ value: 'test-model', label: 'Test', effort: { values: [{ value: 'high', label: 'High' }] } }],
      DEFAULT: 'test-model',
    } as never),
    normalizeMessage: (raw, sessionId) => sessions.normalizeMessage(raw, sessionId),
    isProviderInstalled: async () => true,
    spawnCodexAppServer: spawnChild,
  };
}

function createWriter() {
  const messages: AnyRecord[] = [];
  return { messages, writer: { isWebSocketWriter: true, send: (message: unknown) => messages.push(message as AnyRecord) } };
}

async function until(check: () => boolean) {
  for (let i = 0; i < 200 && !check(); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.ok(check(), 'condition was never met');
}

/**
 * The run's own terminal `complete`. A successful turn also yields the
 * normalized `turn_complete` (no exit code) just before it, as the exec
 * transport always has; the run registry forwards whichever comes first.
 */
function terminalCompletes(messages: AnyRecord[]) {
  return messages.filter((message) => message.kind === 'complete' && typeof message.exitCode === 'number');
}

function finishTurn(server: ScriptedServer, status = 'completed', error: AnyRecord | null = null) {
  server.notify('turn/completed', { threadId: THREAD_ID, turn: { id: TURN_ID, status, error } });
}

for (const [permissionMode, approvalPolicy, sandbox] of [
  [undefined, 'on-request', 'workspace-write'],
  ['acceptEdits', 'never', 'workspace-write'],
  ['bypassPermissions', 'never', 'danger-full-access'],
] as const) {
  test(`Codex app-server run starts a thread and a turn (${permissionMode ?? 'default'})`, async () => {
    const { spawnChild, server } = createScriptedAppServer();
    const { messages, writer } = createWriter();

    const run = codexRuntime.run('hey there', {
      sessionId: `app-start-${permissionMode}`,
      permissionMode,
      effort: 'high',
      cwd: process.cwd(),
    }, writer, createContext(spawnChild));

    const threadStart = await server.waitFor((message) => message.method === 'thread/start');
    assert.equal(threadStart.params.approvalPolicy, approvalPolicy);
    assert.equal(threadStart.params.sandbox, sandbox);
    assert.equal(threadStart.params.model, 'test-model');
    assert.equal(threadStart.params.cwd, process.cwd());

    const turnStart = await server.waitFor((message) => message.method === 'turn/start');
    assert.equal(turnStart.params.threadId, THREAD_ID);
    assert.equal(turnStart.params.effort, 'high');
    assert.deepEqual(turnStart.params.input, [{ type: 'text', text: 'hey there', text_elements: [] }]);

    server.notify('item/completed', {
      threadId: THREAD_ID,
      turnId: TURN_ID,
      item: { type: 'userMessage', id: 'u1', content: [{ type: 'text', text: 'hey there' }] },
    });
    server.notify('item/completed', {
      threadId: THREAD_ID,
      turnId: TURN_ID,
      item: { type: 'agentMessage', id: 'a1', text: 'Hello!' },
    });
    server.notify('thread/tokenUsage/updated', {
      threadId: THREAD_ID,
      turnId: TURN_ID,
      tokenUsage: {
        total: { totalTokens: 900, inputTokens: 800, outputTokens: 100 },
        last: { totalTokens: 300, inputTokens: 250, outputTokens: 50 },
        modelContextWindow: 1000,
      },
    });
    finishTurn(server);
    await run;

    const created = messages.find((message) => message.kind === 'session_created');
    assert.equal(created?.newSessionId, THREAD_ID);
    const texts = messages.filter((message) => message.kind === 'text');
    assert.deepEqual(texts.map((message) => [message.role, message.content]), [['assistant', 'Hello!']]);
    const budget = messages.find((message) => message.kind === 'status' && message.text === 'token_budget');
    assert.equal(budget?.tokenBudget.used, 300);
    assert.equal(budget?.tokenBudget.total, 1000);
    const complete = terminalCompletes(messages);
    assert.equal(complete.length, 1);
    assert.equal(complete[0].exitCode, 0);
    assert.ok(server.killed(), 'the child is closed once the turn ends');
  });
}

test('Codex app-server run resumes the recorded thread', async () => {
  const { spawnChild, server } = createScriptedAppServer();
  const { messages, writer } = createWriter();

  const run = codexRuntime.run('again', { sessionId: 'app-resume', cwd: process.cwd() }, writer, createContext(spawnChild, 'thread-old'));
  const resume = await server.waitFor((message) => message.method === 'thread/resume');
  assert.equal(resume.params.threadId, 'thread-old');
  assert.equal(resume.params.excludeTurns, true);
  const turnStart = await server.waitFor((message) => message.method === 'turn/start');
  assert.equal(turnStart.params.threadId, 'thread-old');
  server.notify('turn/completed', { threadId: 'thread-old', turn: { id: TURN_ID, status: 'completed' } });
  await run;

  assert.ok(!server.received.some((message) => message.method === 'thread/start'));
  assert.ok(!messages.some((message) => message.kind === 'session_created'));
  assert.equal(terminalCompletes(messages).length, 1);
});

test('Send now steers the running Codex turn and is refused once it ends', async () => {
  const { spawnChild, server } = createScriptedAppServer();
  const { messages, writer } = createWriter();
  const sessionId = 'app-steer';

  const run = codexRuntime.run('run sleep 8', { sessionId, cwd: process.cwd() }, writer, createContext(spawnChild));
  await server.waitFor((message) => message.method === 'turn/start');
  await until(() => messages.length > 0 || server.received.length >= 4);

  assert.equal(await codexRuntime.inject(sessionId, 'also say BANANA', { images: [], files: [] }), true);
  const steer = await server.waitFor((message) => message.method === 'turn/steer');
  assert.equal(steer.params.threadId, THREAD_ID);
  assert.equal(steer.params.expectedTurnId, TURN_ID);
  assert.deepEqual(steer.params.input, [{ type: 'text', text: 'also say BANANA', text_elements: [] }]);

  finishTurn(server);
  await run;

  assert.equal(await codexRuntime.inject(sessionId, 'too late', { images: [], files: [] }), false);
  assert.equal(server.received.filter((message) => message.method === 'turn/steer').length, 1);
  assert.equal(terminalCompletes(messages).length, 1);
});

test('Send now reports false when Codex refuses the steer', async () => {
  const { spawnChild, server } = createScriptedAppServer((message, scripted) => {
    if (message.method === 'turn/steer') {
      scripted.send({ id: message.id, error: { code: -32600, message: 'no active turn' } });
      return undefined;
    }
    return defaultAnswer(message, scripted);
  });
  const { writer } = createWriter();
  const sessionId = 'app-steer-refused';

  const run = codexRuntime.run('work', { sessionId, cwd: process.cwd() }, writer, createContext(spawnChild));
  await server.waitFor((message) => message.method === 'turn/start');
  await until(() => server.received.length >= 4);
  assert.equal(await codexRuntime.inject(sessionId, 'more', { images: [], files: [] }), false);

  finishTurn(server);
  await run;
});

test('Stop interrupts the Codex turn and sends no second complete', async () => {
  const { spawnChild, server } = createScriptedAppServer();
  const { messages, writer } = createWriter();
  const sessionId = 'app-abort';

  const run = codexRuntime.run('long work', { sessionId, cwd: process.cwd() }, writer, createContext(spawnChild));
  await server.waitFor((message) => message.method === 'turn/start');
  await until(() => server.received.length >= 4);

  assert.equal(await codexRuntime.abort(sessionId), true);
  const interrupt = await server.waitFor((message) => message.method === 'turn/interrupt');
  assert.deepEqual(interrupt.params, { threadId: THREAD_ID, turnId: TURN_ID });
  await run;

  // abort-session sends the run's terminal `complete`; the run itself stays quiet.
  assert.equal(terminalCompletes(messages).length, 0);
  assert.equal(await codexRuntime.inject(sessionId, 'after stop', { images: [], files: [] }), false);
});

for (const [decision, expected] of [
  [{ allow: true }, 'accept'],
  [{ allow: true, rememberEntry: 'Bash(rm:*)' }, 'acceptForSession'],
  [{ allow: false, message: 'no' }, 'decline'],
] as const) {
  test(`A Codex command approval goes through the permission prompt (${expected})`, async () => {
    const { spawnChild, server } = createScriptedAppServer();
    const { messages, writer } = createWriter();
    const sessionId = `app-approval-${expected}`;

    const run = codexRuntime.run('clean up', { sessionId, cwd: process.cwd() }, writer, createContext(spawnChild));
    await server.waitFor((message) => message.method === 'turn/start');
    server.send({
      id: 'srv-1',
      method: 'item/commandExecution/requestApproval',
      params: { threadId: THREAD_ID, turnId: TURN_ID, itemId: 'c1', command: 'rm -rf build', cwd: '/tmp', reason: 'outside sandbox' },
    });
    await until(() => messages.some((message) => message.kind === 'permission_request'));

    const prompt = messages.find((message) => message.kind === 'permission_request')!;
    assert.equal(prompt.toolName, 'Bash');
    assert.equal(prompt.input.command, 'rm -rf build');
    const pending = codexRuntime.permissions.listPending(sessionId) as AnyRecord[];
    assert.equal(pending.length, 1);
    assert.equal(pending[0].requestId, prompt.requestId);

    codexRuntime.permissions.resolve(prompt.requestId, decision);
    const reply = await server.waitFor((message) => message.id === 'srv-1' && !message.method);
    assert.deepEqual(reply.result, { decision: expected });
    assert.ok(messages.some((message) => message.kind === 'permission_resolved' && message.requestId === prompt.requestId));
    assert.equal(codexRuntime.permissions.listPending(sessionId).length, 0);

    finishTurn(server);
    await run;
  });
}

test('A Codex approval still open when the user stops is cancelled', async () => {
  const { spawnChild, server } = createScriptedAppServer();
  const { messages, writer } = createWriter();
  const sessionId = 'app-approval-stop';

  const run = codexRuntime.run('clean up', { sessionId, cwd: process.cwd() }, writer, createContext(spawnChild));
  await server.waitFor((message) => message.method === 'turn/start');
  server.send({
    id: 7,
    method: 'item/fileChange/requestApproval',
    params: { threadId: THREAD_ID, turnId: TURN_ID, itemId: 'f1', reason: 'write outside workspace' },
  });
  await until(() => messages.some((message) => message.kind === 'permission_request'));
  const prompt = messages.find((message) => message.kind === 'permission_request')!;
  assert.equal(prompt.toolName, 'Edit');

  await codexRuntime.abort(sessionId);
  const reply = await server.waitFor((message) => message.id === 7 && !message.method);
  assert.deepEqual(reply.result, { decision: 'cancel' });
  assert.ok(messages.some((message) => message.kind === 'permission_cancelled' && message.requestId === prompt.requestId));
  await run;
});

test('Codex command output streams into the running row', async () => {
  const { spawnChild, server } = createScriptedAppServer();
  const { messages, writer } = createWriter();

  const run = codexRuntime.run('build it', { sessionId: 'app-output', cwd: process.cwd() }, writer, createContext(spawnChild));
  await server.waitFor((message) => message.method === 'turn/start');
  server.notify('item/started', {
    threadId: THREAD_ID,
    turnId: TURN_ID,
    item: { type: 'commandExecution', id: 'cmd1', command: 'make', status: 'inProgress', aggregatedOutput: null, exitCode: null },
  });
  server.notify('item/commandExecution/outputDelta', { threadId: THREAD_ID, turnId: TURN_ID, itemId: 'cmd1', delta: 'step 1\n' });
  server.notify('item/commandExecution/outputDelta', { threadId: THREAD_ID, turnId: TURN_ID, itemId: 'cmd1', delta: 'step 2\n' });
  await until(() => messages.some((message) => message.kind === 'tool_result' && message.content === 'step 1\nstep 2\n'));

  server.notify('item/completed', {
    threadId: THREAD_ID,
    turnId: TURN_ID,
    item: { type: 'commandExecution', id: 'cmd1', command: 'make', status: 'failed', aggregatedOutput: 'step 1\nstep 2\nboom\n', exitCode: 2 },
  });
  finishTurn(server);
  await run;

  const results = messages.filter((message) => message.kind === 'tool_result' && message.toolId === 'cmd1');
  const last = results[results.length - 1];
  assert.equal(last.content, 'step 1\nstep 2\nboom\n');
  assert.equal(last.isError, true);
  const uses = messages.filter((message) => message.kind === 'tool_use' && message.toolId === 'cmd1');
  assert.ok(uses.every((message) => message.toolName === 'Bash' && message.toolInput.command === 'make'));
});

test('A failed Codex turn shows its error and completes with exit code 1', async () => {
  const { spawnChild, server } = createScriptedAppServer();
  const { messages, writer } = createWriter();

  const run = codexRuntime.run('hi', { sessionId: 'app-failed', cwd: process.cwd() }, writer, createContext(spawnChild));
  await server.waitFor((message) => message.method === 'turn/start');
  server.notify('error', { threadId: THREAD_ID, turnId: TURN_ID, willRetry: false, error: { message: 'You have hit your usage limit.' } });
  finishTurn(server, 'failed', { message: 'You have hit your usage limit.' });
  await run;

  const errors = messages.filter((message) => message.kind === 'error');
  assert.deepEqual(errors.map((message) => message.content), ['You have hit your usage limit.']);
  const complete = terminalCompletes(messages);
  assert.equal(complete.length, 1);
  assert.equal(complete[0].exitCode, 1);
});

test('A Codex app-server that dies mid-turn ends the run with an error', async () => {
  const { spawnChild, server } = createScriptedAppServer();
  const { messages, writer } = createWriter();

  const run = codexRuntime.run('hi', { sessionId: 'app-crash', cwd: process.cwd() }, writer, createContext(spawnChild));
  await server.waitFor((message) => message.method === 'turn/start');
  await until(() => server.received.length >= 4);
  server.crash();
  await run;

  const errors = messages.filter((message) => message.kind === 'error');
  assert.equal(errors.length, 1);
  assert.match(errors[0].content, /codex app-server exited/);
  const complete = terminalCompletes(messages);
  assert.equal(complete.length, 1);
  assert.equal(complete[0].exitCode, 1);
});

test('Codex notifications from other threads (sub-agents) are not drawn', async () => {
  const { spawnChild, server } = createScriptedAppServer();
  const { messages, writer } = createWriter();

  const run = codexRuntime.run('delegate', { sessionId: 'app-subagent', cwd: process.cwd() }, writer, createContext(spawnChild));
  await server.waitFor((message) => message.method === 'turn/start');
  server.notify('item/completed', {
    threadId: 'sub-thread',
    turnId: 'sub-turn',
    item: { type: 'agentMessage', id: 'sub-a1', text: 'sub-agent chatter' },
  });
  server.notify('item/completed', {
    threadId: THREAD_ID,
    turnId: TURN_ID,
    item: { type: 'agentMessage', id: 'a1', text: 'main answer' },
  });
  finishTurn(server);
  await run;

  assert.deepEqual(messages.filter((message) => message.kind === 'text').map((message) => message.content), ['main answer']);
});

test('Send now is refused for a Codex session with no running turn', async () => {
  assert.equal(await codexRuntime.inject('no-such-session', 'hello', { images: [], files: [] }), false);
});
