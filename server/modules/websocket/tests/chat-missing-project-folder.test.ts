import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  closeConnection,
  getConnection,
  initializeDatabase,
  notificationPreferencesDb,
  sessionsDb,
  userDb,
} from '@/modules/database/index.js';
import { registerDesktopNotificationClient, unregisterDesktopNotificationClient } from '@/modules/notifications/index.js';
import { sessionsService } from '@/modules/providers/index.js';
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

type FakeSocket = EventEmitter & {
  readyState: number;
  OPEN: number;
  frames: Array<Record<string, unknown>>;
  send: (data: string) => void;
  close: () => void;
};

function createFakeSocket(): FakeSocket {
  const socket = new EventEmitter() as FakeSocket;
  socket.readyState = 1;
  socket.OPEN = 1;
  socket.frames = [];
  socket.send = (data: string) => {
    const frame = JSON.parse(data) as Record<string, unknown>;
    socket.frames.push(frame);
    socket.emit('test:frame', frame);
  };
  socket.close = () => {};
  return socket;
}

/**
 * Resolves once the run's terminal `complete` frame reached the socket. Every
 * turn ends with one: the gateway emits it for a turn it stops, and for a
 * runtime that returns without its own. The handler is async and the socket
 * listener does not await it, so this is how a test knows the turn is over.
 * Gives up after `timeoutMs`, so a turn that never ends fails the test instead
 * of hanging it.
 */
function waitForComplete(socket: FakeSocket, timeoutMs = 5000): Promise<void> {
  if (socket.frames.some((frame) => frame.kind === 'complete')) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const onFrame = (frame: Record<string, unknown>) => {
      if (frame.kind === 'complete') {
        clearTimeout(timer);
        socket.off('test:frame', onFrame);
        resolve();
      }
    };
    const timer = setTimeout(() => {
      socket.off('test:frame', onFrame);
      reject(new Error(`No complete frame within ${timeoutMs} ms`));
    }, timeoutMs);
    socket.on('test:frame', onFrame);
  });
}

type RunCall = { provider: string; options: Record<string, unknown> };

const runtime = (runs: RunCall[]) => ({
  hasRuntime: () => true,
  run: async (provider: string, _command: string, options: Record<string, unknown>) => {
    runs.push({ provider, options });
  },
}) as never;

type SessionContext = { projectPath: string | null; userId: number };

/**
 * Creates a user and the session with the project path `pickProjectPath`
 * returns for a fresh temp directory, so a test can point it at a missing
 * folder, a file, or the directory itself. `null` leaves the session without
 * a project, as when its project row is removed. `transcriptRows` gives the
 * session a transcript, which an edit needs.
 */
async function withSession(
  setup: {
    pickProjectPath: (tempDirectory: string) => Promise<string | null>;
    provider?: string;
    transcriptRows?: unknown[];
  },
  runTest: (context: SessionContext) => Promise<void>,
): Promise<void> {
  const provider = setup.provider ?? 'claude';
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'chat-missing-project-folder-'));
  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  await initializeDatabase();
  try {
    // A real user row: notification preferences reference it.
    const userId = Number(userDb.createUser('triage', 'not-a-real-hash').id);
    const projectPath = await setup.pickProjectPath(tempDirectory);
    if (setup.transcriptRows) {
      const transcriptPath = path.join(tempDirectory, `${SESSION_ID}.jsonl`);
      const transcript = setup.transcriptRows.map((row) => JSON.stringify(row)).join('\n');
      await writeFile(transcriptPath, `${transcript}\n`, 'utf8');
      const now = new Date().toISOString();
      sessionsDb.createSession(SESSION_ID, provider, projectPath ?? tempDirectory, 'WSL session', now, now, transcriptPath);
    } else {
      sessionsDb.createAppSession(SESSION_ID, provider, projectPath ?? tempDirectory);
    }
    if (projectPath === null) {
      getConnection().prepare('UPDATE sessions SET project_path = NULL WHERE session_id = ?').run(SESSION_ID);
    }
    await runTest({ projectPath: sessionsDb.getSessionById(SESSION_ID)?.project_path ?? null, userId });
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

const missingFolder = async (tempDirectory: string) => path.join(tempDirectory, 'home', 'nobody', 'wsl-project');

/** Sends one chat frame for the session and returns what the gateway did with it. */
async function send(options?: Record<string, unknown>) {
  const socket = createFakeSocket();
  const runs: RunCall[] = [];
  handleChatConnection(socket as never, { user: { id: 1 } } as never, { runtime: runtime(runs) });
  socket.emit('message', JSON.stringify({ type: 'chat.send', sessionId: SESSION_ID, content: 'hello', options }));
  await waitForComplete(socket);
  return { socket, runs, error: socket.frames.find((frame) => frame.kind === 'error') };
}

test('a send for a session whose project folder is missing names the folder instead of starting the CLI', async () => {
  await withSession({ pickProjectPath: missingFolder }, async ({ projectPath }) => {
    const { socket, runs, error } = await send();

    assert.equal(runs.length, 0, 'no provider runtime may be spawned in a folder that does not exist');

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
  await withSession({ pickProjectPath: missingFolder, provider: 'cursor' }, async () => {
    const { runs, error } = await send();

    assert.equal(runs.length, 0);
    assert.match(String(error?.content), /was not found on this machine/);
  });
});

test('a scheduled turn for a file where the project folder should be reports why it failed', async () => {
  await withSession({
    pickProjectPath: async (tempDirectory) => {
      const filePath = path.join(tempDirectory, 'not-a-folder');
      await writeFile(filePath, '', 'utf8');
      return filePath;
    },
  }, async ({ projectPath, userId }) => {
    const runs: RunCall[] = [];
    const result = await runDetachedChatTurn(
      { sessionId: SESSION_ID, userId, content: 'nightly checks' },
      { runtime: runtime(runs) },
    );

    assert.equal(runs.length, 0);
    // The scheduled-message dispatcher records this text on the schedule.
    assert.equal(result.started, true);
    assert.ok(result.error?.includes(`"${projectPath}"`));
  });
});

test('a turn nobody is watching still sends the "run failed" notification', async () => {
  await withSession({ pickProjectPath: missingFolder }, async ({ projectPath, userId }) => {
    // The runtimes notify on their own failures; a turn stopped before any
    // runtime starts has to do the same, or a scheduled turn that fires
    // overnight fails without a word.
    notificationPreferencesDb.updatePreferences(userId, { channels: { desktop: true }, events: { error: true } });
    const desktop = createFakeSocket();
    registerDesktopNotificationClient({ userId, deviceId: 'test-desktop', ws: desktop as never });

    try {
      const result = await runDetachedChatTurn(
        { sessionId: SESSION_ID, userId, content: 'nightly checks', options: { sessionSummary: 'Nightly checks' } },
        { runtime: runtime([]) },
      );
      assert.ok(result.error);
    } finally {
      unregisterDesktopNotificationClient(desktop as never);
    }

    const notification = desktop.frames.find((frame) => frame.type === 'notification');
    assert.ok(notification, 'a desktop notification is delivered');
    const payload = notification?.payload as { title: string; body: string; data: Record<string, unknown> };
    assert.equal(payload.data.code, 'run.failed');
    assert.equal(payload.data.sessionId, SESSION_ID);
    assert.equal(payload.title, 'Nightly checks');
    assert.ok(payload.body.includes(`"${projectPath}"`), 'the notification names the missing folder');
  });
});

/** The same two turns as a Codex rollout; Codex rewinds an edit on disk. */
const CODEX_TRANSCRIPT_ROWS = [
  { type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-a' } },
  { type: 'event_msg', payload: { type: 'user_message', message: 'first' } },
  { type: 'event_msg', payload: { type: 'task_complete', turn_id: 'turn-a' } },
  { type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-b' } },
  { type: 'event_msg', payload: { type: 'user_message', message: 'second' } },
  { type: 'event_msg', payload: { type: 'task_complete', turn_id: 'turn-b' } },
];

test('an edit in a missing folder neither truncates the chat nor rewinds the conversation', async () => {
  await withSession({
    pickProjectPath: missingFolder,
    provider: 'codex',
    transcriptRows: CODEX_TRANSCRIPT_ROWS,
  }, async () => {
    // A Codex rewind moves the session onto a new rollout and cannot be taken
    // back, so it must not happen for a turn that is about to fail.
    const realRewind = sessionsService.rewindSessionForEdit;
    let rewound = false;
    sessionsService.rewindSessionForEdit = async () => { rewound = true; };

    const socket = createFakeSocket();
    const runs: RunCall[] = [];
    try {
      handleChatConnection(socket as never, { user: { id: 1 } } as never, { runtime: runtime(runs) });
      socket.emit('message', JSON.stringify({
        type: 'chat.edit-send',
        sessionId: SESSION_ID,
        anchorId: 'turn-b',
        content: 'a better second prompt',
      }));
      await waitForComplete(socket);
    } finally {
      sessionsService.rewindSessionForEdit = realRewind;
    }

    assert.equal(runs.length, 0);
    assert.equal(rewound, false, 'the conversation is not rewound');
    assert.equal(socket.frames.some((frame) => frame.kind === 'history_truncated'), false, 'the chat is not truncated');
    assert.match(String(socket.frames.find((frame) => frame.kind === 'error')?.content), /was not found on this machine/);
    assert.equal(socket.frames.find((frame) => frame.kind === 'complete')?.exitCode, 1);
  });
});

/**
 * Which directory is checked, and which failures count as "not there". The
 * runtimes run in `options.cwd` when a client sends one and in the project
 * path otherwise; with neither they use the server's own cwd.
 */
const directoryCases: Array<{
  name: string;
  pickProjectPath: (tempDirectory: string) => Promise<string | null>;
  provider?: string;
  options?: (tempDirectory: string) => Record<string, unknown>;
  blocked: boolean;
}> = [
  {
    name: 'a project path below a regular file (ENOTDIR) is reported as missing',
    pickProjectPath: async (tempDirectory) => {
      await writeFile(path.join(tempDirectory, 'a-file'), '', 'utf8');
      return path.join(tempDirectory, 'a-file', 'project');
    },
    blocked: true,
  },
  {
    name: 'a missing options.cwd is reported even when the project folder exists',
    pickProjectPath: async (tempDirectory) => tempDirectory,
    options: (tempDirectory) => ({ cwd: path.join(tempDirectory, 'gone') }),
    blocked: true,
  },
  {
    name: 'an empty options.cwd falls back to the project path, as the runtimes do',
    pickProjectPath: missingFolder,
    provider: 'cursor',
    options: () => ({ cwd: '' }),
    blocked: true,
  },
  {
    // The runtimes test truthiness, not trimmed text, so they would spawn in
    // this path and fail with ENOENT. It is checked like any other path.
    name: 'a whitespace-only options.cwd is checked as a path, as the runtimes use it',
    pickProjectPath: async (tempDirectory) => tempDirectory,
    options: () => ({ cwd: '  ' }),
    blocked: true,
  },
  {
    // A link is followed, like spawn follows it: a project folder that is a
    // symlink to a real folder (or a Windows junction) is a folder.
    name: 'a project folder that is a symlink to a real folder still runs',
    pickProjectPath: async (tempDirectory) => {
      const realFolder = path.join(tempDirectory, 'real-project');
      const linkedFolder = path.join(tempDirectory, 'linked-project');
      await mkdir(realFolder);
      await symlink(realFolder, linkedFolder, 'junction');
      return linkedFolder;
    },
    blocked: false,
  },
  {
    name: 'a session without a project path still runs',
    pickProjectPath: async () => null,
    blocked: false,
  },
  {
    name: 'an empty directory from the client still runs',
    pickProjectPath: async () => null,
    options: () => ({ projectPath: '' }),
    blocked: false,
  },
  ...(process.platform !== 'win32' && process.getuid?.() !== 0
    ? [{
      name: 'a folder that cannot be checked (EACCES) is left for the runtime to report',
      pickProjectPath: async (tempDirectory: string) => {
        const locked = path.join(tempDirectory, 'locked');
        await mkdir(path.join(locked, 'project'), { recursive: true });
        await chmod(locked, 0o000);
        return path.join(locked, 'project');
      },
      blocked: false,
    }]
    : []),
];

for (const directoryCase of directoryCases) {
  test(directoryCase.name, async () => {
    let tempDirectory = '';
    await withSession({
      pickProjectPath: async (directory) => {
        tempDirectory = directory;
        return directoryCase.pickProjectPath(directory);
      },
      provider: directoryCase.provider,
    }, async () => {
      try {
        const { runs, error } = await send(directoryCase.options?.(tempDirectory));
        if (directoryCase.blocked) {
          assert.equal(runs.length, 0);
          assert.match(String(error?.content), /was not found on this machine/);
        } else {
          assert.equal(runs.length, 1);
          assert.equal(error, undefined);
        }
      } finally {
        // Lets the temp directory be removed after the EACCES case.
        await chmod(path.join(tempDirectory, 'locked'), 0o700).catch(() => {});
      }
    });
  });
}

test('a session whose project folder exists still runs in it', async () => {
  await withSession({ pickProjectPath: async (tempDirectory) => tempDirectory }, async ({ projectPath }) => {
    const { runs, error } = await send();

    assert.equal(runs.length, 1);
    assert.equal(runs[0].options.cwd, projectPath);
    assert.equal(error, undefined);
  });
});
