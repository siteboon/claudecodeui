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

const SESSION_ID = 'held-session';

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

type StopCall = { provider: string; sessionId: string; taskId: string };

/**
 * A gateway whose runtime knows exactly one background task. There is no chat
 * run in progress: the turn that launched the task has ended, which is the
 * state a stop request arrives in.
 */
async function withGateway(
  knownTaskId: string,
  runTest: (context: {
    socket: ReturnType<typeof createFakeSocket>;
    stops: StopCall[];
  }) => Promise<void>,
): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'chat-stop-task-'));

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  await initializeDatabase();

  const stops: StopCall[] = [];
  const socket = createFakeSocket();

  try {
    sessionsDb.createAppSession(SESSION_ID, 'claude', tempDirectory);

    handleChatConnection(
      socket as never,
      { user: { id: 1 } } as never,
      {
        runtime: {
          stopBackgroundTask: async (provider: string, sessionId: string, taskId: string) => {
            stops.push({ provider, sessionId, taskId });
            return taskId === knownTaskId;
          },
        } as never,
      },
    );

    await runTest({ socket, stops });
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

test('chat.stop-task stops the task through the session\'s provider runtime', async () => {
  await withGateway('task-1', async ({ socket, stops }) => {
    socket.emit('message', JSON.stringify({ type: 'chat.stop-task', sessionId: SESSION_ID, taskId: 'task-1' }));
    await settle();

    // The provider comes from the session row, never from the frame.
    assert.deepEqual(stops, [{ provider: 'claude', sessionId: SESSION_ID, taskId: 'task-1' }]);
    // The runtime reports the stop on the session's stream; nothing is echoed here.
    assert.deepEqual(socket.frames, []);
  });
});

test('a task the runtime is not tracking is refused with NO_SUCH_TASK', async () => {
  await withGateway('task-1', async ({ socket, stops }) => {
    socket.emit('message', JSON.stringify({ type: 'chat.stop-task', sessionId: SESSION_ID, taskId: 'already-settled' }));
    await settle();

    assert.equal(stops.length, 1);
    assert.equal(socket.frames.length, 1);
    assert.equal(socket.frames[0].kind, 'protocol_error');
    assert.equal(socket.frames[0].code, 'NO_SUCH_TASK');
    assert.equal(socket.frames[0].sessionId, SESSION_ID);
  });
});

test('a stop without a task id never reaches the runtime', async () => {
  await withGateway('task-1', async ({ socket, stops }) => {
    socket.emit('message', JSON.stringify({ type: 'chat.stop-task', sessionId: SESSION_ID }));
    await settle();

    assert.equal(stops.length, 0);
    assert.equal(socket.frames.at(-1)?.code, 'TASK_ID_REQUIRED');
  });
});

test('a stop for a session that does not exist is refused', async () => {
  await withGateway('task-1', async ({ socket, stops }) => {
    socket.emit('message', JSON.stringify({ type: 'chat.stop-task', sessionId: 'no-such-session', taskId: 'task-1' }));
    await settle();

    assert.equal(stops.length, 0);
    assert.equal(socket.frames.at(-1)?.code, 'SESSION_NOT_FOUND');
  });
});
