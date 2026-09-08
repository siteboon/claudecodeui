import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import os from 'node:os';
import path from 'node:path';

import {
  createCodexAppServerRuntime,
  type CodexAppServerProcess,
} from '@/modules/providers/list/codex/index.js';
import { createNormalizedMessage } from '@/shared/utils.js';
import type {
  AnyRecord,
  NormalizedMessage,
  ProviderRuntimeContext,
  ProviderRuntimeWriter,
} from '@/shared/types.js';

class FakeAppServerProcess extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly pid = 4321;

  kill(): boolean {
    queueMicrotask(() => this.emit('exit', null, 'SIGTERM'));
    return true;
  }
}

type RuntimeHarness = {
  process: FakeAppServerProcess;
  requests: Record<string, unknown>[];
  nextRequest: () => Promise<Record<string, unknown>>;
  notify: (method: string, params: Record<string, unknown>) => void;
  respondWithResult: (request: Record<string, unknown>, result: unknown) => void;
  respondWithError: (request: Record<string, unknown>, code: number, message: string) => void;
};

function createHarness(options: { failThreadStart?: boolean } = {}): RuntimeHarness {
  const process = new FakeAppServerProcess();
  const requests: Record<string, unknown>[] = [];
  const waiters: Array<(request: Record<string, unknown>) => void> = [];
  let inputBuffer = '';

  process.stdin.on('data', (chunk: Buffer | string) => {
    inputBuffer += String(chunk);
    let newlineIndex = inputBuffer.indexOf('\n');
    while (newlineIndex >= 0) {
      const line = inputBuffer.slice(0, newlineIndex).trim();
      inputBuffer = inputBuffer.slice(newlineIndex + 1);
      if (!line) {
        newlineIndex = inputBuffer.indexOf('\n');
        continue;
      }

      const request = JSON.parse(line) as Record<string, unknown>;
      const waiter = waiters.shift();
      if (waiter) {
        waiter(request);
      } else {
        requests.push(request);
      }

      if (request.method === 'initialize') {
        process.stdout.write(JSON.stringify({
          id: request.id,
          result: { userAgent: 'codex-test' },
        }) + '\n');
      } else if (request.method === 'thread/start') {
        if (!options.failThreadStart) {
          process.stdout.write(JSON.stringify({
            id: request.id,
            result: { thread: { id: 'thread-new' } },
          }) + '\n');
        }
      } else if (request.method === 'thread/resume') {
        process.stdout.write(JSON.stringify({
          id: request.id,
          result: { thread: { id: request.params && (request.params as AnyRecord).threadId } },
        }) + '\n');
      } else if (request.method === 'turn/start') {
        process.stdout.write(JSON.stringify({
          id: request.id,
          result: { turn: { id: 'turn-1', status: 'inProgress' } },
        }) + '\n');
      } else if (request.method === 'turn/interrupt') {
        process.stdout.write(JSON.stringify({ id: request.id, result: {} }) + '\n');
      }

      newlineIndex = inputBuffer.indexOf('\n');
    }
  });

  return {
    process,
    requests,
    nextRequest: () => {
      const request = requests.shift();
      if (request) {
        return Promise.resolve(request);
      }
      return new Promise((resolve) => waiters.push(resolve));
    },
    notify: (method, params) => {
      process.stdout.write(JSON.stringify({ method, params }) + '\n');
    },
    respondWithResult: (request, result) => {
      process.stdout.write(JSON.stringify({ id: request.id, result }) + '\n');
    },
    respondWithError: (request, code, message) => {
      process.stdout.write(JSON.stringify({
        id: request.id,
        error: { code, message },
      }) + '\n');
    },
  };
}

function createWriter(): { writer: ProviderRuntimeWriter; messages: NormalizedMessage[]; providerSessionId: string | null } {
  const messages: NormalizedMessage[] = [];
  let providerSessionId: string | null = null;
  return {
    messages,
    get providerSessionId() {
      return providerSessionId;
    },
    writer: {
      send(data) {
        messages.push(data as NormalizedMessage);
      },
      setSessionId(sessionId) {
        providerSessionId = sessionId;
      },
    },
  };
}

const context: ProviderRuntimeContext = {
  resolveProviderSessionId: (sessionId) => sessionId === 'resume-app' ? 'thread-existing' : null,
  resolveResumeModel: async (_sessionId, requestedModel) => requestedModel ?? 'gpt-test',
  getProviderModels: async () => ({
    OPTIONS: [{ value: 'gpt-test', label: 'GPT Test', effort: { values: [{ value: 'medium' }] } }],
    DEFAULT: 'gpt-test',
  }),
  normalizeMessage: (raw, sessionId) => {
    const record = raw as AnyRecord;
    if (record.type === 'item' && record.itemType === 'user_message') {
      return [createNormalizedMessage({
        kind: 'text',
        provider: 'codex',
        sessionId,
        role: 'user',
        content: (record.message as AnyRecord)?.content,
        id: record.uuid as string | undefined,
      })];
    }
    if (record.type === 'item' && record.itemType === 'agent_message') {
      return [createNormalizedMessage({
        kind: 'text',
        provider: 'codex',
        sessionId,
        role: 'assistant',
        content: (record.message as AnyRecord)?.content,
        id: record.uuid as string | undefined,
      })];
    }
    if (record.type === 'item' && record.itemType === 'command_execution') {
      return [createNormalizedMessage({
        kind: 'tool_use',
        provider: 'codex',
        sessionId,
        toolName: 'Bash',
        toolInput: { command: record.command },
        toolId: record.uuid as string | undefined,
        output: record.output,
        status: record.status,
      })];
    }
    if (record.type === 'item' && record.itemType === 'reasoning') {
      return [createNormalizedMessage({
        kind: 'thinking',
        provider: 'codex',
        sessionId,
        content: (record.message as AnyRecord)?.content,
        id: record.uuid as string | undefined,
      })];
    }
    if (record.type === 'error') {
      return [createNormalizedMessage({
        kind: 'error',
        provider: 'codex',
        sessionId,
        content: record.message as string,
      })];
    }
    return [];
  },
  isProviderInstalled: async () => true,
};

function createRuntime(process: FakeAppServerProcess) {
  return createCodexAppServerRuntime({
    managerOptions: {
      clientInfo: { name: 'cloudcli-runtime-test', version: 'test' },
      spawn: () => process as unknown as CodexAppServerProcess,
    },
  });
}

test('uses the owned app-server process for thread list, read, and name requests', async () => {
  const harness = createHarness();
  const runtime = createRuntime(harness.process);

  const listPromise = runtime.listThreads({ limit: 25 });
  assert.equal((await harness.nextRequest()).method, 'initialize');
  assert.equal((await harness.nextRequest()).method, 'initialized');
  const listRequest = await harness.nextRequest();
  assert.equal(listRequest.method, 'thread/list');
  assert.deepEqual(listRequest.params, { limit: 25 });
  harness.respondWithResult(listRequest, { data: [], nextCursor: null, backwardsCursor: null });
  assert.deepEqual(await listPromise, { data: [], nextCursor: null, backwardsCursor: null });

  const readPromise = runtime.readThread('thread-history', true);
  const readRequest = await harness.nextRequest();
  assert.equal(readRequest.method, 'thread/read');
  assert.deepEqual(readRequest.params, { threadId: 'thread-history', includeTurns: true });
  harness.respondWithResult(readRequest, { thread: { id: 'thread-history', turns: [] } });
  assert.deepEqual(await readPromise, { thread: { id: 'thread-history', turns: [] } });

  const namePromise = runtime.setThreadName('thread-history', 'New title');
  const nameRequest = await harness.nextRequest();
  assert.equal(nameRequest.method, 'thread/name/set');
  assert.deepEqual(nameRequest.params, { threadId: 'thread-history', name: 'New title' });
  harness.respondWithResult(nameRequest, {});
  await namePromise;
});

test('starts/resumes a thread, submits a turn, and normalizes completed items', async () => {
  const harness = createHarness();
  const runtime = createRuntime(harness.process);
  const output = createWriter();

  const runPromise = runtime.run(
    'Explain the change',
    {
      sessionId: 'app-new',
      cwd: 'C:\\workspace',
      files: [{ path: 'notes.txt' }],
      images: [],
    },
    output.writer,
    context,
  );

  const initialize = await harness.nextRequest();
  assert.equal(initialize.method, 'initialize');
  assert.equal(initialize.jsonrpc, undefined);
  const initialized = await harness.nextRequest();
  assert.deepEqual(initialized, { method: 'initialized' });
  const threadStart = await harness.nextRequest();
  assert.equal(threadStart.method, 'thread/start');
  assert.equal((threadStart.params as AnyRecord).cwd, 'C:\\workspace');
  assert.equal((threadStart.params as AnyRecord).sandbox, 'workspace-write');
  assert.equal((threadStart.params as AnyRecord).approvalPolicy, 'untrusted');
  const turnStart = await harness.nextRequest();
  assert.equal(turnStart.method, 'turn/start');
  assert.deepEqual((turnStart.params as AnyRecord).input, [{
    type: 'text',
    text: 'Explain the change\n\n<files_input>\nThe user attached 1 file(s) to this message. Read each file listed below with your file reading tools and use its contents to answer the prompt above. Do not mention this block or the file paths unless the user asks about them.\n1. notes.txt\n</files_input>',
  }]);

  harness.notify('item/completed', {
    threadId: 'thread-new',
    turnId: 'turn-1',
    item: {
      type: 'userMessage',
      id: 'user-echo',
      content: [{ type: 'text', text: 'Explain the change' }],
    },
  });

  harness.process.stdout.write(JSON.stringify({
    id: 99,
    method: 'item/commandExecution/requestApproval',
    params: {
      threadId: 'thread-new',
      turnId: 'turn-1',
      itemId: 'item-approval',
      startedAtMs: 1,
    },
  }) + '\n');
  const approval = output.messages.find((message) => message.kind === 'permission_request');
  assert.ok(approval?.requestId);
  runtime.permissions.resolve(approval.requestId, { allow: false });
  assert.deepEqual(await harness.nextRequest(), {
    id: 99,
    result: { decision: 'decline' },
  });

  harness.notify('item/completed', {
    threadId: 'thread-new',
    turnId: 'turn-1',
    item: { type: 'agentMessage', id: 'item-1', text: 'The change is ready.' },
  });
  harness.notify('item/completed', {
    threadId: 'thread-new',
    turnId: 'turn-1',
    item: {
      type: 'reasoning',
      id: 'item-reasoning',
      summary: ['First thought.', 'Second thought.'],
      content: [],
    },
  });
  harness.notify('item/completed', {
    threadId: 'thread-new',
    turnId: 'turn-1',
    item: {
      type: 'commandExecution',
      id: 'item-2',
      command: 'npm test',
      aggregatedOutput: 'ok',
      status: 'completed',
      exitCode: 0,
    },
  });
  harness.notify('thread/tokenUsage/updated', {
    threadId: 'thread-new',
    turnId: 'turn-1',
    tokenUsage: {
      total: {
        inputTokens: 120,
        cachedInputTokens: 20,
        outputTokens: 30,
        reasoningOutputTokens: 10,
        totalTokens: 150,
      },
      last: {
        inputTokens: 120,
        cachedInputTokens: 20,
        outputTokens: 30,
        reasoningOutputTokens: 10,
        totalTokens: 150,
      },
      modelContextWindow: 200000,
    },
  });
  harness.notify('turn/completed', {
    threadId: 'thread-new',
    turnId: 'turn-1',
    turn: { id: 'turn-1', status: 'completed' },
  });

  const result = await runPromise;
  assert.deepEqual(result, { status: 'completed' });
  assert.equal(output.providerSessionId, 'thread-new');
  assert.equal(output.messages.some((message) => message.kind === 'session_created'), true);
  assert.equal(output.messages.some((message) => message.id === 'user-echo'), false);
  assert.equal(output.messages.some((message) => message.kind === 'text' && message.content === 'The change is ready.'), true);
  assert.equal(output.messages.some((message) => message.kind === 'thinking' && message.content === 'First thought.\nSecond thought.'), true);
  assert.equal(output.messages.some((message) => message.kind === 'tool_use' && message.toolName === 'Bash'), true);
  const tokenStatuses = output.messages.filter((message) => message.kind === 'status');
  assert.equal(tokenStatuses.length, 1);
  assert.equal((tokenStatuses[0]?.tokenBudget as AnyRecord)?.used, 150);
  assert.equal((tokenStatuses[0]?.tokenBudget as AnyRecord)?.total, 200000);
  assert.equal(output.messages.filter((message) => message.kind === 'complete').length, 1);
  assert.equal(output.messages.at(-1)?.success, true);
});

test('maps a failed turn to an error and one unsuccessful complete event', async () => {
  const harness = createHarness();
  const runtime = createRuntime(harness.process);
  const output = createWriter();

  const runPromise = runtime.run('Fail', { sessionId: 'resume-app' }, output.writer, context);
  await harness.nextRequest();
  await harness.nextRequest();
  const resume = await harness.nextRequest();
  assert.equal(resume.method, 'thread/resume');
  assert.equal((resume.params as AnyRecord).threadId, 'thread-existing');
  await harness.nextRequest();

  harness.notify('turn/completed', {
    threadId: 'thread-existing',
    turnId: 'turn-1',
    turn: {
      id: 'turn-1',
      status: 'failed',
      error: { message: 'Model quota exceeded' },
    },
  });

  const result = await runPromise;
  assert.deepEqual(result, { status: 'failed', error: 'Model quota exceeded' });
  assert.equal(output.messages.some((message) => message.kind === 'error' && message.content === 'Model quota exceeded'), true);
  assert.equal(output.messages.filter((message) => message.kind === 'complete').length, 1);
  assert.equal(output.messages.at(-1)?.success, false);
});

test('interrupts an active turn and reports an aborted completion', async () => {
  const harness = createHarness();
  const runtime = createRuntime(harness.process);
  const output = createWriter();

  const runPromise = runtime.run('Stop this', { sessionId: 'app-abort' }, output.writer, context);
  await harness.nextRequest();
  await harness.nextRequest();
  await harness.nextRequest();
  await harness.nextRequest();

  assert.equal(await runtime.abort('app-abort'), true);
  const interrupt = await harness.nextRequest();
  assert.equal(interrupt.method, 'turn/interrupt');
  assert.deepEqual(interrupt.params, { threadId: 'thread-new', turnId: 'turn-1' });

  harness.notify('turn/completed', {
    threadId: 'thread-new',
    turnId: 'turn-1',
    turn: { id: 'turn-1', status: 'interrupted' },
  });

  const result = await runPromise;
  assert.deepEqual(result, { status: 'interrupted' });
  assert.equal(output.messages.at(-1)?.aborted, true);
  assert.equal(output.messages.at(-1)?.success, false);
});

test('refuses to restart while an app-server turn is active', async () => {
  const harness = createHarness();
  const runtime = createRuntime(harness.process);
  const output = createWriter();

  const runPromise = runtime.run('Keep running', { sessionId: 'app-busy' }, output.writer, context);
  await harness.nextRequest();
  await harness.nextRequest();
  await harness.nextRequest();
  await harness.nextRequest();

  await assert.rejects(
    runtime.restart(),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, 'CODEX_APP_SERVER_BUSY');
      return true;
    },
  );

  harness.notify('turn/completed', {
    threadId: 'thread-new',
    turnId: 'turn-1',
    turn: { id: 'turn-1', status: 'completed' },
  });
  await runPromise;
});

test('surfaces a pre-turn app-server failure without runtime fallback', async () => {
  const harness = createHarness({ failThreadStart: true });
  const runtime = createRuntime(harness.process);
  const output = createWriter();

  const runPromise = runtime.run('Fail before turn', { sessionId: 'app-pre-turn' }, output.writer, context);
  await harness.nextRequest();
  await harness.nextRequest();
  const threadStart = await harness.nextRequest();
  harness.respondWithError(threadStart, -32010, 'Cannot start thread');

  await assert.rejects(runPromise, (error: unknown) => {
    assert.equal(error instanceof Error, true);
    assert.equal((error as Error).name, 'CodexAppServerPreTurnError');
    assert.match((error as Error).message, /Cannot start thread/);
    return true;
  });
});

test('forks a persisted thread through the app-server protocol', async () => {
  const harness = createHarness();
  const runtime = createRuntime(harness.process);
  const directory = await mkdtemp(path.join(os.tmpdir(), 'codex-app-server-fork-'));
  const transcriptPath = path.join(directory, 'fork.jsonl');
  await writeFile(transcriptPath, '');

  try {
    const forkPromise = runtime.forkThread({
      threadId: 'thread-source',
      lastTurnId: 'turn-2',
      cwd: directory,
    });
    assert.equal((await harness.nextRequest()).method, 'initialize');
    assert.equal((await harness.nextRequest()).method, 'initialized');
    const forkRequest = await harness.nextRequest();
    assert.equal(forkRequest.method, 'thread/fork');
    assert.deepEqual(forkRequest.params, {
      threadId: 'thread-source',
      lastTurnId: 'turn-2',
      cwd: directory,
    });

    harness.respondWithResult(forkRequest, {
      thread: {
        id: 'thread-forked',
        path: transcriptPath,
        forkedFromId: 'thread-source',
        turns: [],
      },
    });

    assert.deepEqual(await forkPromise, { threadId: 'thread-forked', path: transcriptPath });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
