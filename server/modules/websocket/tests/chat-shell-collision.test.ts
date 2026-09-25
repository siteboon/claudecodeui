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
    killed: false,
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
    kill() {
      this.killed = true;
    },
  };
}

type ShellInit = Record<string, unknown>;

/** The Shell tab as the test drives it: its CLI, typing into it, and leaving it (the socket closes). */
type ShellTab = {
  pty: ReturnType<typeof createFakePty>;
  type: (data: string) => void;
  leave: () => void;
};

/**
 * A chat gateway over an isolated database, plus a way to open the Shell tab
 * on the same session the way the browser does. Shell PTYs are fakes whose
 * exit the test controls.
 */
async function withGateway(
  runTest: (context: {
    chatSocket: ReturnType<typeof createFakeSocket>;
    runs: string[];
    aborts: string[];
    runtime: never;
    openShell: (init?: ShellInit) => ShellTab;
  }) => Promise<void>,
): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'chat-shell-collision-'));

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  await initializeDatabase();

  const runs: string[] = [];
  const aborts: string[] = [];
  const shellPtys: Array<ReturnType<typeof createFakePty>> = [];
  const chatSocket = createFakeSocket();
  const runtime = {
    hasRuntime: () => true,
    run: async (_provider: string, command: string) => {
      runs.push(command);
    },
    abort: async (_provider: string, sessionId: string) => {
      aborts.push(sessionId);
      return true;
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
    return {
      pty: fakePty,
      type: (data: string) => shellSocket.emit('message', JSON.stringify({ type: 'input', data })),
      leave: () => shellSocket.emit('close'),
    };
  };

  try {
    sessionsDb.createAppSession(SESSION_ID, 'claude', tempDirectory, 'Shell collision session');
    handleChatConnection(chatSocket as never, { user: { id: 1 } } as never, { runtime });

    await runTest({ chatSocket, runs, aborts, runtime, openShell });
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

/**
 * The handler is async and the socket listener does not await it, so each test
 * waits for the answer it asserts on (a frame, or a run), not a fixed delay
 * that a loaded machine can outlast.
 */
async function settleUntil(isAnswered: () => boolean): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!isAnswered() && Date.now() < deadline) {
    await new Promise((resolve) => { setTimeout(resolve, 10); });
  }
}

const sendFrame = (content: string) => JSON.stringify({ type: 'chat.send', sessionId: SESSION_ID, content });

test('chat.send is refused while the session is open in a live agent Shell', async () => {
  await withGateway(async ({ chatSocket, runs, openShell }) => {
    const shell = openShell();

    chatSocket.emit('message', sendFrame('second writer'));
    await settleUntil(() => chatSocket.frames.length > 0);

    assert.deepEqual(runs, []);
    assert.equal(chatRunRegistry.isProcessing(SESSION_ID), false);
    assert.equal(chatSocket.frames.length, 1);
    assert.equal(chatSocket.frames[0].kind, 'protocol_error');
    assert.equal(chatSocket.frames[0].code, 'SESSION_OPEN_IN_SHELL');
    assert.equal(chatSocket.frames[0].sessionId, SESSION_ID);
    // Shown verbatim in the chat, so it has to say what to do about it. The
    // tab only shows the session, so leaving it is enough.
    assert.match(String(chatSocket.frames[0].error), /open in the Shell tab/);
    assert.match(String(chatSocket.frames[0].error), /Leave the Shell tab/);
    assert.equal(shell.pty.killed, false, 'the user\'s CLI is never ended for a send');

    // Once the Shell's CLI exits, the same send goes through.
    shell.pty.emitExit();
    chatSocket.emit('message', sendFrame('after exit'));
    await settleUntil(() => runs.length > 0);

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
    await settleUntil(() => runs.length > 0 || chatSocket.frames.length > 0);

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
    assert.equal(result.busy, 'SESSION_OPEN_IN_SHELL');
    assert.match(String(result.error), /open in the Shell tab/);
    assert.deepEqual(runs, []);
    assert.equal(chatRunRegistry.isProcessing(SESSION_ID), false);
  });
});

test('a Shell that was only opened and then left is ended, and the send goes through', async () => {
  await withGateway(async ({ chatSocket, runs, openShell }) => {
    // Looking at the Shell tab resumes the session in a CLI; switching back to
    // Chat closes the tab's socket and leaves that CLI idle on its timeout.
    const shell = openShell();
    shell.type('\x1b[I');
    shell.leave();

    chatSocket.emit('message', sendFrame('after a look at the Shell'));
    await settleUntil(() => runs.length > 0 || chatSocket.frames.length > 0);

    assert.equal(shell.pty.killed, true);
    assert.deepEqual(runs, ['after a look at the Shell']);
    assert.equal(chatSocket.frames.some((frame) => frame.kind === 'protocol_error'), false);
  });
});

test('a Shell the user ran something in keeps the session after it is left', async () => {
  await withGateway(async ({ chatSocket, runs, openShell }) => {
    const shell = openShell();
    shell.type('run the migration\r');
    shell.leave();

    chatSocket.emit('message', sendFrame('would be a second writer'));
    await settleUntil(() => runs.length > 0 || chatSocket.frames.length > 0);

    assert.equal(shell.pty.killed, false);
    assert.deepEqual(runs, []);
    assert.equal(chatSocket.frames[0]?.code, 'SESSION_OPEN_IN_SHELL');
    // Its CLI has run something, so only exiting that CLI frees the session.
    assert.match(String(chatSocket.frames[0]?.error), /in use in the Shell tab/);
    assert.match(String(chatSocket.frames[0]?.error), /Exit that CLI there/);
  });
});

test('a scheduled turn that a Shell refuses does not interrupt the turn it would replace', async () => {
  await withGateway(async ({ runs, aborts, runtime, openShell }) => {
    openShell();
    // A turn that got going while the Shell was up (the agent API does not
    // check the Shell; the registry is driven directly).
    const run = chatRunRegistry.startRun({
      appSessionId: SESSION_ID,
      provider: 'claude',
      providerSessionId: 'provider-sid',
      connection: null,
      userId: null,
    });
    assert.ok(run);

    const result = await runDetachedChatTurn(
      { sessionId: SESSION_ID, userId: 1, content: 'scheduled', interruptActiveRun: true },
      { runtime },
    );

    assert.equal(result.started, false);
    assert.deepEqual(aborts, []);
    assert.equal(chatRunRegistry.isProcessing(SESSION_ID), true);
    assert.deepEqual(runs, []);
  });
});
