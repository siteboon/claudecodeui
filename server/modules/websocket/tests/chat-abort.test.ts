import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { chatRunRegistry } from '@/modules/websocket/services/chat-run-registry.service.js';
import { handleChatConnection, runDetachedChatTurn } from '@/modules/websocket/services/chat-websocket.service.js';
import { connectedClients } from '@/modules/websocket/services/websocket-state.service.js';

const sessionId = 'abort-session';
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

async function withGateway(
  abort: () => Promise<boolean>,
  check: (fixture: ReturnType<typeof createGateway>) => Promise<void>,
) {
  const previous = process.env.DATABASE_PATH;
  const directory = await mkdtemp(path.join(os.tmpdir(), 'chat-abort-'));
  closeConnection();
  process.env.DATABASE_PATH = path.join(directory, 'test.db');
  await initializeDatabase();
  try {
    sessionsDb.createAppSession(sessionId, 'codex', directory);
    await check(createGateway(abort));
  } finally {
    connectedClients.clear();
    chatRunRegistry.clearAll();
    closeConnection();
    if (previous === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previous;
    await rm(directory, { recursive: true, force: true });
  }
}

function createGateway(abort: () => Promise<boolean>) {
  const frames: Array<Record<string, unknown>> = [];
  const socket = Object.assign(new EventEmitter(), {
    readyState: 1,
    send: (data: string) => { frames.push(JSON.parse(data)); },
  });
  let dispatched = 0;
  const dependencies = {
    runtime: {
      hasRuntime: () => true,
      run: async () => { dispatched += 1; },
      abort,
      askSideQuestion: async () => { throw new Error('Unexpected side question'); },
      stopBackgroundTask: async () => false,
      steer: async () => false,
      hasBackgroundWork: () => false,
      resolveToolApproval() {},
      getPendingApprovalsForSession: () => [],
    },
  };
  handleChatConnection(socket as never, { user: { id: 1 } } as never, dependencies);
  const start = () => {
    const run = chatRunRegistry.startRun({
      appSessionId: sessionId, provider: 'codex', providerSessionId: null,
      connection: socket, userId: null,
    });
    assert.ok(run);
    return run;
  };
  const run = start();
  return {
    run, start, frames, dependencies,
    get dispatched() { return dispatched; },
    abort: () => socket.emit('message', JSON.stringify({ type: 'chat.abort', sessionId })),
  };
}

for (const failure of ['false', 'throw']) {
  test(`keeps the run active when abort returns ${failure}`, async () => {
    await withGateway(async () => {
      if (failure === 'throw') throw new Error('Provider unavailable');
      return false;
    }, async ({ abort, frames }) => {
      abort();
      await flush();
      assert.equal(chatRunRegistry.isProcessing(sessionId), true);
      assert.equal(frames.some((frame) => frame.kind === 'complete'), false);
      assert.equal(frames.at(-1)?.code, 'ABORT_FAILED');
      assert.equal(frames.at(-1)?.sessionId, sessionId);
    });
  });
}

test('keeps the session reserved until abort is confirmed', async () => {
  let confirm = (_value: boolean) => {};
  const pending = new Promise<boolean>((resolve) => { confirm = resolve; });
  await withGateway(() => pending, async ({ abort, frames }) => {
    abort();
    await flush();
    assert.equal(chatRunRegistry.isProcessing(sessionId), true);
    assert.equal(frames.some((frame) => frame.kind === 'complete'), false);
    confirm(true);
    await flush();
    assert.equal(chatRunRegistry.isProcessing(sessionId), false);
    assert.equal(frames.filter((frame) => frame.kind === 'complete').length, 1);
    assert.equal(frames.at(-1)?.aborted, true);
  });
});

test('a delayed abort response cannot finish a newer run', async () => {
  let confirm = (_value: boolean) => {};
  const pending = new Promise<boolean>((resolve) => { confirm = resolve; });
  await withGateway(() => pending, async ({ abort, run, start, frames }) => {
    abort();
    run.writer.sendComplete({ exitCode: 0, aborted: true });
    const next = start();
    confirm(true);
    await flush();
    assert.equal(chatRunRegistry.getRun(sessionId), next);
    assert.equal(chatRunRegistry.isProcessing(sessionId), true);
    assert.equal(frames.filter((frame) => frame.kind === 'complete').length, 1);
  });
});

test('scheduled turns do not replace a run whose abort failed', async () => {
  await withGateway(async () => false, async (fixture) => {
    const result = await runDetachedChatTurn({
      sessionId, userId: null, content: 'Scheduled follow-up', interruptActiveRun: true,
    }, fixture.dependencies);
    assert.equal(result.started, false);
    assert.equal(fixture.dispatched, 0);
    assert.equal(chatRunRegistry.isProcessing(sessionId), true);
    assert.equal(fixture.frames.some((frame) => frame.kind === 'complete'), false);
  });
});
