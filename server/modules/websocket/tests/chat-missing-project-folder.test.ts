import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { handleChatConnection, runDetachedChatTurn } from '@/modules/websocket/services/chat-websocket.service.js';
import { chatRunRegistry } from '@/modules/websocket/services/chat-run-registry.service.js';
import { connectedClients } from '@/modules/websocket/services/websocket-state.service.js';

/**
 * A session's project folder can exist only somewhere else: a Windows CloudCLI
 * lists the sessions Claude Code wrote inside WSL, whose cwd is a Linux path
 * like /home/<user>/project (issue #779). Spawning a CLI there fails with
 * ENOENT, which the Claude SDK reports as "Claude Code native binary not
 * found" — so the turn has to stop before any runtime is asked to start.
 */

const SESSION_ID = 'wsl-session';

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

type RunCall = { provider: string; options: Record<string, unknown> };

const runtime = (runs: RunCall[]) => ({
  hasRuntime: () => true,
  run: async (provider: string, _command: string, options: Record<string, unknown>) => {
    runs.push({ provider, options });
  },
}) as never;

/**
 * Creates the session with the project path `pickProjectPath` returns for a
 * fresh temp directory, so a test can point it at a missing folder, a file,
 * or the directory itself.
 */
async function withSession(
  pickProjectPath: (tempDirectory: string) => Promise<string>,
  runTest: (projectPath: string) => Promise<void>,
  provider = 'claude',
): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'chat-missing-project-folder-'));
  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  await initializeDatabase();
  try {
    const projectPath = await pickProjectPath(tempDirectory);
    sessionsDb.createAppSession(SESSION_ID, provider, projectPath);
    await runTest(sessionsDb.getSessionById(SESSION_ID)?.project_path ?? projectPath);
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

const missingFolder = async (tempDirectory: string) => path.join(tempDirectory, 'home', 'nobody', 'wsl-project');

test('a send for a session whose project folder is missing names the folder instead of starting the CLI', async () => {
  await withSession(missingFolder, async (projectPath) => {
    const socket = createFakeSocket();
    const runs: RunCall[] = [];
    handleChatConnection(socket as never, { user: { id: 1 } } as never, { runtime: runtime(runs) });

    socket.emit('message', JSON.stringify({ type: 'chat.send', sessionId: SESSION_ID, content: 'hello' }));
    await settle();

    assert.equal(runs.length, 0, 'no provider runtime may be spawned in a folder that does not exist');

    const error = socket.frames.find((frame) => frame.kind === 'error');
    assert.ok(error, 'the failure reaches the chat as an ordinary error message');
    assert.equal(error?.sessionId, SESSION_ID);
    assert.match(String(error?.content), /was not found on this machine/);
    assert.ok(String(error?.content).includes(`"${projectPath}"`), 'the error names the missing folder');
    assert.match(String(error?.content), /WSL/);

    // The run ends like a failed turn, so the composer is usable again.
    const complete = socket.frames.find((frame) => frame.kind === 'complete');
    assert.equal(complete?.exitCode, 1);
    assert.equal(chatRunRegistry.isProcessing(SESSION_ID), false);
  });
});

test('every provider gets the same check, not just Claude', async () => {
  await withSession(missingFolder, async () => {
    const socket = createFakeSocket();
    const runs: RunCall[] = [];
    handleChatConnection(socket as never, { user: { id: 1 } } as never, { runtime: runtime(runs) });

    socket.emit('message', JSON.stringify({ type: 'chat.send', sessionId: SESSION_ID, content: 'hello' }));
    await settle();

    assert.equal(runs.length, 0);
    assert.match(String(socket.frames.find((frame) => frame.kind === 'error')?.content), /was not found on this machine/);
  }, 'cursor');
});

test('a scheduled turn for a file where the project folder should be reports why it failed', async () => {
  await withSession(async (tempDirectory) => {
    const filePath = path.join(tempDirectory, 'not-a-folder');
    await writeFile(filePath, '', 'utf8');
    return filePath;
  }, async (projectPath) => {
    const runs: RunCall[] = [];
    const result = await runDetachedChatTurn(
      { sessionId: SESSION_ID, userId: 1, content: 'nightly checks' },
      { runtime: runtime(runs) },
    );

    assert.equal(runs.length, 0);
    // The scheduled-message dispatcher records this text on the schedule.
    assert.equal(result.started, true);
    assert.ok(result.error?.includes(`"${projectPath}"`));
  });
});

test('a session whose project folder exists still runs in it', async () => {
  await withSession(async (tempDirectory) => tempDirectory, async (projectPath) => {
    const socket = createFakeSocket();
    const runs: RunCall[] = [];
    handleChatConnection(socket as never, { user: { id: 1 } } as never, { runtime: runtime(runs) });

    socket.emit('message', JSON.stringify({ type: 'chat.send', sessionId: SESSION_ID, content: 'hello' }));
    await settle();

    assert.equal(runs.length, 1);
    assert.equal(runs[0].options.cwd, projectPath);
    assert.equal(socket.frames.some((frame) => frame.kind === 'error'), false);
  });
});
