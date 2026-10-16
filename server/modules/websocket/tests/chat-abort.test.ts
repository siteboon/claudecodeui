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

const SESSION_ID = 'stop-session';

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

type AbortCall = { provider: string; sessionId: string };

/**
 * A gateway whose runtime says whether the session still has background work
 * — agents, workflows or commands its last turn launched — and records the
 * aborts it is asked for.
 */
async function withGateway(
  backgroundWork: boolean,
  runTest: (context: { socket: ReturnType<typeof createFakeSocket>; aborts: AbortCall[] }) => Promise<void>,
): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'chat-abort-'));

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  await initializeDatabase();

  const aborts: AbortCall[] = [];
  const socket = createFakeSocket();

  try {
    sessionsDb.createAppSession(SESSION_ID, 'claude', tempDirectory);

    handleChatConnection(
      socket as never,
      { user: { id: 1 } } as never,
      {
        runtime: {
          abort: async (provider: string, sessionId: string) => {
            aborts.push({ provider, sessionId });
            return true;
          },
          hasBackgroundWork: (sessionId: string) => backgroundWork && sessionId === SESSION_ID,
        } as never,
      },
    );

    await runTest({ socket, aborts });
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

test('Stop on a session left with only background work stops that work', async () => {
  await withGateway(true, async ({ socket, aborts }) => {
    // The turn that launched the work has ended, so no chat run is going.
    socket.emit('message', JSON.stringify({ type: 'chat.abort', sessionId: SESSION_ID }));
    await settle();

    // The provider comes from the session row, never from the frame.
    assert.deepEqual(aborts, [{ provider: 'claude', sessionId: SESSION_ID }]);
    assert.equal(socket.frames.some((frame) => frame.kind === 'protocol_error'), false);
  });
});

test('Stop on a session with nothing running is refused with NO_ACTIVE_RUN', async () => {
  await withGateway(false, async ({ socket, aborts }) => {
    socket.emit('message', JSON.stringify({ type: 'chat.abort', sessionId: SESSION_ID }));
    await settle();

    assert.deepEqual(aborts, []);
    assert.equal(socket.frames.at(-1)?.code, 'NO_ACTIVE_RUN');
  });
});

test('Stop on a running turn aborts its run', async () => {
  await withGateway(false, async ({ socket, aborts }) => {
    chatRunRegistry.startRun({
      appSessionId: SESSION_ID,
      provider: 'claude',
      providerSessionId: null,
      connection: null,
      userId: 1,
    });

    socket.emit('message', JSON.stringify({ type: 'chat.abort', sessionId: SESSION_ID }));
    await settle();

    assert.deepEqual(aborts, [{ provider: 'claude', sessionId: SESSION_ID }]);
    assert.equal(chatRunRegistry.getRun(SESSION_ID)?.status === 'running', false, 'the run is completed as aborted');
  });
});
