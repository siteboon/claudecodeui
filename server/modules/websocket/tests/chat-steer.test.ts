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
import type { AnyRecord } from '@/shared/types.js';

const SESSION_ID = 'steer-session';
const MESSAGE_ID = '0b5c3f8e-6d1a-4c2b-9e7f-1a2b3c4d5e6f';

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

type SteerCall = { provider: string; sessionId: string; command: string; options: AnyRecord };

/**
 * A gateway whose runtime accepts or refuses every steer as `accepts` says.
 * `running` decides whether the session has a chat run in progress.
 */
async function withGateway(
  { accepts, running }: { accepts: boolean; running: boolean },
  runTest: (context: { socket: ReturnType<typeof createFakeSocket>; steers: SteerCall[] }) => Promise<void>,
): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'chat-steer-'));

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  await initializeDatabase();

  const steers: SteerCall[] = [];
  const socket = createFakeSocket();

  try {
    sessionsDb.createAppSession(SESSION_ID, 'claude', tempDirectory);
    if (running) {
      chatRunRegistry.startRun({
        appSessionId: SESSION_ID,
        provider: 'claude',
        providerSessionId: null,
        connection: null,
        userId: 1,
      });
    }

    handleChatConnection(
      socket as never,
      { user: { id: 1 } } as never,
      {
        runtime: {
          hasRuntime: () => true,
          steer: async (provider: string, sessionId: string, command: string, options: AnyRecord) => {
            steers.push({ provider, sessionId, command, options });
            return accepts;
          },
        } as never,
      },
    );

    await runTest({ socket, steers });
  } finally {
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

/** The handler is async and the socket listener does not await it. */
const settle = () => new Promise((resolve) => { setTimeout(resolve, 30); });

test('chat.steer hands the message to the session\'s provider runtime', async () => {
  await withGateway({ accepts: true, running: true }, async ({ socket, steers }) => {
    socket.emit('message', JSON.stringify({
      type: 'chat.steer',
      sessionId: SESSION_ID,
      messageId: MESSAGE_ID,
      content: 'change course',
    }));
    await settle();

    assert.equal(steers.length, 1);
    // The provider comes from the session row, never from the frame.
    assert.equal(steers[0].provider, 'claude');
    assert.equal(steers[0].sessionId, SESSION_ID);
    assert.equal(steers[0].command, 'change course');
    assert.equal(steers[0].options.messageId, MESSAGE_ID);
    assert.deepEqual(steers[0].options.images, []);
    assert.deepEqual(steers[0].options.files, []);
    // The sender learns it was taken; the echo comes later on the run stream.
    assert.equal(socket.frames.length, 1);
    assert.equal(socket.frames[0].kind, 'chat_steer_accepted');
    assert.equal(socket.frames[0].messageId, MESSAGE_ID);
    assert.equal(socket.frames[0].sessionId, SESSION_ID);
  });
});

test('a steer with no running turn is refused with STEER_UNAVAILABLE, naming the message', async () => {
  await withGateway({ accepts: true, running: false }, async ({ socket, steers }) => {
    socket.emit('message', JSON.stringify({ type: 'chat.steer', sessionId: SESSION_ID, messageId: MESSAGE_ID, content: 'hi' }));
    await settle();

    assert.equal(steers.length, 0, 'never reaches the runtime');
    assert.equal(socket.frames.at(-1)?.code, 'STEER_UNAVAILABLE');
    assert.equal(socket.frames.at(-1)?.messageId, MESSAGE_ID);
    assert.equal(socket.frames.at(-1)?.sessionId, SESSION_ID);
  });
});

test('a steer the runtime refuses (the turn just ended) is reported the same way', async () => {
  await withGateway({ accepts: false, running: true }, async ({ socket, steers }) => {
    socket.emit('message', JSON.stringify({ type: 'chat.steer', sessionId: SESSION_ID, messageId: MESSAGE_ID, content: 'hi' }));
    await settle();

    assert.equal(steers.length, 1);
    assert.equal(socket.frames.at(-1)?.code, 'STEER_UNAVAILABLE');
    assert.equal(socket.frames.at(-1)?.messageId, MESSAGE_ID);
  });
});

test('a message id that is not a UUID is replaced, since it becomes the transcript uuid', async () => {
  await withGateway({ accepts: true, running: true }, async ({ steers, socket }) => {
    socket.emit('message', JSON.stringify({ type: 'chat.steer', sessionId: SESSION_ID, messageId: '../etc', content: 'hi' }));
    await settle();

    assert.equal(steers.length, 1);
    assert.match(String(steers[0].options.messageId), /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});

test('an empty steer is refused before it reaches the runtime', async () => {
  await withGateway({ accepts: true, running: true }, async ({ socket, steers }) => {
    socket.emit('message', JSON.stringify({ type: 'chat.steer', sessionId: SESSION_ID, messageId: MESSAGE_ID, content: '   ' }));
    await settle();

    assert.equal(steers.length, 0);
    assert.equal(socket.frames.at(-1)?.code, 'MESSAGE_REQUIRED');
  });
});
