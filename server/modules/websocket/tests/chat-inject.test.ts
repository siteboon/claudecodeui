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

const SESSION_ID = 'running-session';

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

type InjectCall = { provider: string; sessionId: string; text: string; attachments: unknown };

/** A gateway whose runtime takes every "Send now" message it is offered. */
async function withGateway(
  runTest: (context: {
    socket: ReturnType<typeof createFakeSocket>;
    injects: InjectCall[];
  }) => Promise<void>,
  // Whether the runtime has a live turn to take the message.
  runtimeAccepts = true,
): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'chat-inject-'));

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  await initializeDatabase();

  const injects: InjectCall[] = [];
  const socket = createFakeSocket();

  try {
    sessionsDb.createAppSession(SESSION_ID, 'claude', tempDirectory);

    handleChatConnection(
      socket as never,
      { user: { id: 1 } } as never,
      {
        runtime: {
          hasRuntime: () => true,
          inject: async (provider: string, sessionId: string, text: string, attachments: unknown) => {
            injects.push({ provider, sessionId, text, attachments });
            return runtimeAccepts;
          },
        } as never,
      },
    );

    await runTest({ socket, injects });
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

test('chat.inject hands the message to the running turn and answers accepted', async () => {
  await withGateway(async ({ socket, injects }) => {
    chatRunRegistry.startRun({ appSessionId: SESSION_ID, provider: 'claude', providerSessionId: null, connection: null, userId: 1 });
    socket.emit('message', JSON.stringify({ type: 'chat.inject', sessionId: SESSION_ID, requestId: 'r1', content: 'steer' }));
    await settle();

    assert.deepEqual(injects, [{ provider: 'claude', sessionId: SESSION_ID, text: 'steer', attachments: { images: [], files: [] } }]);
    assert.equal(socket.frames.length, 1);
    assert.equal(socket.frames[0].kind, 'inject_result');
    assert.equal(socket.frames[0].requestId, 'r1');
    assert.equal(socket.frames[0].accepted, true);
  });
});

test('chat.inject with no live turn anywhere is refused so the client queues it', async () => {
  await withGateway(async ({ socket, injects }) => {
    socket.emit('message', JSON.stringify({ type: 'chat.inject', sessionId: SESSION_ID, requestId: 'r2', content: 'steer' }));
    await settle();

    assert.equal(injects.length, 1, 'the runtime is asked');
    assert.equal(socket.frames.at(-1)?.kind, 'inject_result');
    assert.equal(socket.frames.at(-1)?.accepted, false);
    assert.equal(socket.frames.at(-1)?.reason, 'NOT_ACCEPTED');
  }, false);
});

test('chat.inject reaches a turn the held process started by itself after the run completed', async () => {
  await withGateway(async ({ socket, injects }) => {
    socket.emit('message', JSON.stringify({ type: 'chat.inject', sessionId: SESSION_ID, requestId: 'r4', content: 'steer' }));
    await settle();

    assert.deepEqual(injects.map((call) => call.provider), ['claude'], 'the provider comes from the session row');
    assert.equal(socket.frames.at(-1)?.accepted, true);
  });
});

test('chat.inject for a session that does not exist is refused', async () => {
  await withGateway(async ({ socket, injects }) => {
    socket.emit('message', JSON.stringify({ type: 'chat.inject', sessionId: 'no-such-session', requestId: 'r5', content: 'steer' }));
    await settle();

    assert.equal(injects.length, 0);
    assert.equal(socket.frames.at(-1)?.reason, 'NO_ACTIVE_RUN');
  });
});

test('chat.inject drops attachments outside the upload store', async () => {
  await withGateway(async ({ socket, injects }) => {
    chatRunRegistry.startRun({ appSessionId: SESSION_ID, provider: 'claude', providerSessionId: null, connection: null, userId: 1 });
    socket.emit('message', JSON.stringify({
      type: 'chat.inject',
      sessionId: SESSION_ID,
      requestId: 'r3',
      content: 'look',
      options: { attachments: [{ path: '/etc/passwd', name: 'passwd' }] },
    }));
    await settle();

    assert.deepEqual(injects[0]?.attachments, { images: [], files: [] });
  });
});

test('chat.inject on a running Codex turn goes to the Codex runtime', async () => {
  await withGateway(async ({ socket, injects }) => {
    chatRunRegistry.startRun({ appSessionId: SESSION_ID, provider: 'codex', providerSessionId: null, connection: null, userId: 1 });
    socket.emit('message', JSON.stringify({ type: 'chat.inject', sessionId: SESSION_ID, requestId: 'r4', content: 'also say BANANA' }));
    await settle();

    assert.deepEqual(injects, [{ provider: 'codex', sessionId: SESSION_ID, text: 'also say BANANA', attachments: { images: [], files: [] } }]);
    assert.equal(socket.frames.at(-1)?.accepted, true);
  });
});
