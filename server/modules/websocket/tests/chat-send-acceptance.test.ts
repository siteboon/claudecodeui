import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { handleChatConnection } from '@/modules/websocket/services/chat-websocket.service.js';
import { chatRunRegistry } from '@/modules/websocket/services/chat-run-registry.service.js';
import { connectedClients } from '@/modules/websocket/services/websocket-state.service.js';

/**
 * `WebSocket.send()` in the browser only queues a frame, so a `chat.send` can
 * be lost while the socket still reports OPEN — and the composer used to clear
 * the draft and open the new session anyway (#1452). A frame tagged with a
 * `clientRequestId` is now acknowledged once its run is admitted, a refusal
 * echoes the id, and a retry of the same frame is acknowledged again instead
 * of starting the turn twice. Frames without an id behave exactly as before.
 */

const SESSION_ID = 'acceptance-session';

function createFakeSocket() {
  const socket = new EventEmitter() as EventEmitter & {
    readyState: number;
    frames: Array<Record<string, unknown>>;
    send: (data: string) => void;
  };
  socket.readyState = 1;
  socket.frames = [];
  socket.send = (data: string) => socket.frames.push(JSON.parse(data) as Record<string, unknown>);
  return socket;
}

/**
 * Set by a test that needs the run to still be going when the next frame
 * arrives; released when the test ends so no stub run outlives it.
 */
let releaseHeldRun: (() => void) | null = null;
let holdRun: Promise<void> | null = null;

function holdTheNextRun(): void {
  holdRun = new Promise<void>((resolve) => { releaseHeldRun = resolve; });
}

async function withGateway(
  runTest: (context: {
    socket: ReturnType<typeof createFakeSocket>;
    runs: string[];
    send: (frame: Record<string, unknown>) => Promise<void>;
  }) => Promise<void>,
): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'chat-send-acceptance-'));

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  await initializeDatabase();

  const runs: string[] = [];
  const socket = createFakeSocket();

  try {
    sessionsDb.createAppSession(SESSION_ID, 'claude', tempDirectory, 'Acceptance session');

    handleChatConnection(
      socket as never,
      { user: { id: 1 } } as never,
      {
        runtime: {
          hasRuntime: () => true,
          run: async (_provider: string, command: string) => {
            runs.push(command);
            // The acknowledgement must already be out while the run is going.
            if (holdRun) {
              await holdRun;
            }
          },
        } as never,
      },
    );

    const send = async (frame: Record<string, unknown>) => {
      socket.emit('message', JSON.stringify(frame));
      // The handler is async and the socket listener does not await it.
      await new Promise((resolve) => { setTimeout(resolve, 30); });
    };

    await runTest({ socket, runs, send });
  } finally {
    releaseHeldRun?.();
    releaseHeldRun = null;
    holdRun = null;
    connectedClients.clear();
    chatRunRegistry.clearAll();
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

const acceptances = (socket: ReturnType<typeof createFakeSocket>) =>
  socket.frames.filter((frame) => frame.kind === 'chat_send_accepted');

test('a tagged chat.send is acknowledged as soon as its run is admitted', async () => {
  await withGateway(async ({ socket, runs, send }) => {
    holdTheNextRun();
    await send({ type: 'chat.send', sessionId: SESSION_ID, content: 'hello', clientRequestId: 'request-1' });

    assert.deepEqual(runs, ['hello']);
    assert.equal(chatRunRegistry.isProcessing(SESSION_ID), true, 'the run is still going');
    assert.deepEqual(
      acceptances(socket).map(({ sessionId, clientRequestId }) => ({ sessionId, clientRequestId })),
      [{ sessionId: SESSION_ID, clientRequestId: 'request-1' }],
    );
  });
});

test('a retry of an admitted frame is acknowledged again without starting a second turn', async () => {
  await withGateway(async ({ socket, runs, send }) => {
    const frame = { type: 'chat.send', sessionId: SESSION_ID, content: 'hello', clientRequestId: 'request-1' };

    // While the first run is still going: no RUN_IN_PROGRESS, just the ack.
    holdTheNextRun();
    await send(frame);
    await send(frame);
    releaseHeldRun?.();
    holdRun = null;
    await new Promise((resolve) => { setTimeout(resolve, 30); });

    // And after it finished: still the same turn, not a new one.
    await send(frame);

    assert.deepEqual(runs, ['hello'], 'the turn ran once');
    assert.deepEqual(
      acceptances(socket).map((acceptance) => acceptance.duplicate ?? false),
      [false, true, true],
      'every copy of the frame was acknowledged, the retries as duplicates of a turn already started',
    );
    assert.equal(socket.frames.some((candidate) => candidate.kind === 'protocol_error'), false);
  });
});

test('a new request id on the same session is a new turn', async () => {
  await withGateway(async ({ runs, send }) => {
    await send({ type: 'chat.send', sessionId: SESSION_ID, content: 'first', clientRequestId: 'request-1' });
    await send({ type: 'chat.send', sessionId: SESSION_ID, content: 'second', clientRequestId: 'request-2' });

    assert.deepEqual(runs, ['first', 'second']);
  });
});

test('a refused tagged send echoes its request id on the protocol error', async () => {
  await withGateway(async ({ socket, runs, send }) => {
    await send({ type: 'chat.send', sessionId: 'no-such-session', content: 'hello', clientRequestId: 'request-1' });

    holdTheNextRun();
    await send({ type: 'chat.send', sessionId: SESSION_ID, content: 'busy', clientRequestId: 'request-2' });
    await send({ type: 'chat.send', sessionId: SESSION_ID, content: 'refused', clientRequestId: 'request-3' });

    const errors = socket.frames.filter((frame) => frame.kind === 'protocol_error');
    assert.deepEqual(
      errors.map(({ code, clientRequestId }) => ({ code, clientRequestId })),
      [
        { code: 'SESSION_NOT_FOUND', clientRequestId: 'request-1' },
        { code: 'RUN_IN_PROGRESS', clientRequestId: 'request-3' },
      ],
    );
    assert.deepEqual(runs, ['busy']);
    assert.deepEqual(acceptances(socket).map((frame) => frame.clientRequestId), ['request-2']);
  });
});

test('a chat.send without a request id is neither acknowledged nor deduplicated', async () => {
  await withGateway(async ({ socket, runs, send }) => {
    const frame = { type: 'chat.send', sessionId: SESSION_ID, content: 'hello' };
    await send(frame);
    await send(frame);
    await send({ type: 'chat.send', sessionId: 'no-such-session', content: 'hello' });

    assert.deepEqual(runs, ['hello', 'hello'], 'two untagged frames are two turns, as before');
    assert.equal(acceptances(socket).length, 0);
    const notFound = socket.frames.find((frame) => frame.code === 'SESSION_NOT_FOUND');
    assert.ok(notFound);
    assert.equal('clientRequestId' in notFound, false, 'no id is invented for an untagged frame');
  });
});

test('a request id longer than 128 characters counts as absent', async () => {
  await withGateway(async ({ socket, runs, send }) => {
    const longestId = 'r'.repeat(128);
    const oversizedId = 'r'.repeat(129);
    await send({ type: 'chat.send', sessionId: SESSION_ID, content: 'tagged', clientRequestId: longestId });
    await send({ type: 'chat.send', sessionId: SESSION_ID, content: 'oversized', clientRequestId: oversizedId });
    await send({ type: 'chat.send', sessionId: SESSION_ID, content: 'oversized', clientRequestId: oversizedId });
    await send({ type: 'chat.send', sessionId: 'no-such-session', content: 'oversized', clientRequestId: oversizedId });

    assert.deepEqual(runs, ['tagged', 'oversized', 'oversized'], 'frames with an oversized id are not deduplicated');
    assert.deepEqual(acceptances(socket).map((frame) => frame.clientRequestId), [longestId]);
    const notFound = socket.frames.find((frame) => frame.code === 'SESSION_NOT_FOUND');
    assert.ok(notFound);
    assert.equal('clientRequestId' in notFound, false, 'an oversized id is not echoed');
  });
});

test('a send that arrives after its unsent session was discarded is refused', async () => {
  await withGateway(async ({ socket, runs, send }) => {
    sessionsDb.deleteSessionById(SESSION_ID);
    await send({ type: 'chat.send', sessionId: SESSION_ID, content: 'late', clientRequestId: 'request-1' });

    assert.deepEqual(runs, []);
    assert.equal(acceptances(socket).length, 0);
    assert.equal(socket.frames[0]?.code, 'SESSION_NOT_FOUND');
    assert.equal(socket.frames[0]?.clientRequestId, 'request-1');
  });
});
