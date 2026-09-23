import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { chatRunRegistry } from '@/modules/websocket/services/chat-run-registry.service.js';
import {
  handleChatConnection,
  runDetachedChatTurn,
} from '@/modules/websocket/services/chat-websocket.service.js';
import { handleShellConnection } from '@/modules/websocket/services/shell-websocket.service.js';
import { connectedClients } from '@/modules/websocket/services/websocket-state.service.js';

const SESSION_ID = 'shell-collision-session';

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

function createFakePty() {
  let exitListener: ((event: { exitCode: number }) => void) | null = null;
  return {
    onData() {
      return { dispose: () => undefined };
    },
    onExit(listener: (event: { exitCode: number }) => void) {
      exitListener = listener;
      return { dispose: () => undefined };
    },
    /** What the PTY reports when the user types `/exit` in its CLI. */
    emitExit() {
      exitListener?.({ exitCode: 0 });
    },
    write() {},
    resize() {},
    kill() {},
  };
}

type ShellInit = Record<string, unknown>;

/**
 * A chat gateway over an isolated database, plus a way to open the Shell tab
 * on the same session the way the browser does. Shell PTYs are fakes whose
 * exit the test controls.
 */
async function withGateway(
  runTest: (context: {
    chatSocket: ReturnType<typeof createFakeSocket>;
    runs: string[];
    runtime: never;
    openShell: (init?: ShellInit) => ReturnType<typeof createFakePty>;
  }) => Promise<void>,
): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'chat-shell-collision-'));

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  await initializeDatabase();

  const runs: string[] = [];
  const shellPtys: Array<ReturnType<typeof createFakePty>> = [];
  const chatSocket = createFakeSocket();
  const runtime = {
    hasRuntime: () => true,
    run: async (_provider: string, command: string) => {
      runs.push(command);
    },
  } as never;

  const openShell = (init: ShellInit = {}) => {
    const fakePty = createFakePty();
    shellPtys.push(fakePty);
    const shellSocket = createFakeSocket();
    handleShellConnection(shellSocket as never, {
      resolveProviderSessionId: () => 'provider-sid',
      spawnPty: () => fakePty as never,
    });
    shellSocket.emit('message', JSON.stringify({
      type: 'init',
      projectPath: tempDirectory,
      sessionId: SESSION_ID,
      hasSession: true,
      provider: 'claude',
      ...init,
    }));
    return fakePty;
  };

  try {
    sessionsDb.createAppSession(SESSION_ID, 'claude', tempDirectory, 'Shell collision session');
    handleChatConnection(chatSocket as never, { user: { id: 1 } } as never, { runtime });

    await runTest({ chatSocket, runs, runtime, openShell });
  } finally {
    shellPtys.forEach((fakePty) => fakePty.emitExit());
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

const sendFrame = (content: string) => JSON.stringify({ type: 'chat.send', sessionId: SESSION_ID, content });

test('chat.send is refused while the session is open in a live agent Shell', async () => {
  await withGateway(async ({ chatSocket, runs, openShell }) => {
    const shellPty = openShell();

    chatSocket.emit('message', sendFrame('second writer'));
    await settle();

    assert.deepEqual(runs, []);
    assert.equal(chatRunRegistry.isProcessing(SESSION_ID), false);
    assert.equal(chatSocket.frames.length, 1);
    assert.equal(chatSocket.frames[0].kind, 'protocol_error');
    assert.equal(chatSocket.frames[0].code, 'SESSION_OPEN_IN_SHELL');
    assert.equal(chatSocket.frames[0].sessionId, SESSION_ID);
    assert.match(String(chatSocket.frames[0].error), /open in the Shell tab/);

    // Once the Shell's CLI exits, the same send goes through.
    shellPty.emitExit();
    chatSocket.emit('message', sendFrame('after exit'));
    await settle();

    assert.deepEqual(runs, ['after exit']);
  });
});

test('a plain shell or a new agent session in the project never blocks chat', async () => {
  await withGateway(async ({ chatSocket, runs, openShell }) => {
    openShell({
      sessionId: null,
      hasSession: false,
      provider: 'plain-shell',
      isPlainShell: true,
      initialCommand: 'ls',
    });
    openShell({ sessionId: null, hasSession: false });

    chatSocket.emit('message', sendFrame('plain shells are not this session'));
    await settle();

    assert.deepEqual(runs, ['plain shells are not this session']);
    assert.equal(chatSocket.frames.some((frame) => frame.kind === 'protocol_error'), false);
  });
});

test('a scheduled turn is not started on a session open in the Shell and says why', async () => {
  await withGateway(async ({ runs, runtime, openShell }) => {
    openShell();

    const result = await runDetachedChatTurn(
      { sessionId: SESSION_ID, userId: 1, content: 'scheduled', interruptActiveRun: true },
      { runtime },
    );

    assert.equal(result.started, false);
    assert.match(String(result.error), /open in the Shell tab/);
    assert.deepEqual(runs, []);
    assert.equal(chatRunRegistry.isProcessing(SESSION_ID), false);
  });
});
