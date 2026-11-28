import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  closeConnection,
  initializeDatabase,
  sessionsDb,
  userDb,
  userPreferencesDb,
} from '@/modules/database/index.js';
import { handleChatConnection } from '@/modules/websocket/services/chat-websocket.service.js';
import { chatRunRegistry } from '@/modules/websocket/services/chat-run-registry.service.js';
import { connectedClients } from '@/modules/websocket/services/websocket-state.service.js';
import type { AnyRecord } from '@/shared/types.js';

const SESSION_ID = 'chat-defaults-session';
const SAVED_DEFAULTS = {
  claude: { model: 'best', effort: 'max' },
  codex: { model: 'gpt-5.6-sol', effort: 'xhigh' },
};

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

const settle = () => new Promise((resolve) => { setTimeout(resolve, 30); });

type GatewayOptions = {
  /** Omitted leaves the handler on its auth.db reader. */
  readChatDefaults?: (userId: number, provider: string) => unknown;
  /** Writes this into the saved preferences before connecting. */
  savedDefaults?: unknown;
  /** Model/effort already recorded on the session row, as a reopened chat has. */
  sessionSelection?: { model?: string; effort?: string };
  userId?: number | null;
};

/**
 * Runs one `chat.send` through the real connection handler and returns the
 * options the provider runtime was handed, plus the recorded session row.
 */
async function sendOneTurn(
  { readChatDefaults, savedDefaults, sessionSelection, userId = 1 }: GatewayOptions,
  clientOptions: AnyRecord = {},
): Promise<{ runs: AnyRecord[]; session: ReturnType<typeof sessionsDb.getSessionById> }> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'chat-defaults-'));
  const runs: AnyRecord[] = [];
  const socket = createFakeSocket();

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  await initializeDatabase();

  try {
    if (savedDefaults !== undefined) {
      const { id } = userDb.createUser('chat-defaults-tester', 'x');
      userPreferencesDb.savePreferences(Number(id), { chatDefaults: savedDefaults });
    }
    sessionsDb.createAppSession(SESSION_ID, 'claude', tempDirectory);
    if (sessionSelection?.model) {
      sessionsDb.setSessionModel(SESSION_ID, sessionSelection.model);
    }
    if (sessionSelection?.effort) {
      sessionsDb.setSessionEffort(SESSION_ID, sessionSelection.effort);
    }

    handleChatConnection(
      socket as never,
      (userId === null ? {} : { user: { id: userId } }) as never,
      {
        runtime: {
          hasRuntime: () => true,
          run: async (_provider: string, _command: string, options: AnyRecord) => {
            runs.push(options);
            return undefined;
          },
        } as never,
        ...(readChatDefaults ? { readChatDefaults } : {}),
      },
    );

    socket.emit('message', JSON.stringify({
      type: 'chat.send',
      sessionId: SESSION_ID,
      content: 'run the task',
      options: clientOptions,
    }));
    await settle();

    return { runs, session: sessionsDb.getSessionById(SESSION_ID) };
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

test('a send that names no model or effort runs with the saved defaults', async () => {
  const { runs, session } = await sendOneTurn({ savedDefaults: SAVED_DEFAULTS });

  assert.equal(runs.length, 1);
  assert.equal(runs[0].model, 'best');
  assert.equal(runs[0].effort, 'max');
  assert.equal(session?.model, 'best');
  assert.equal(session?.effort, 'max');
});

test('the composer sentinel "default" is treated as unspecified', async () => {
  const { runs, session } = await sendOneTurn(
    { savedDefaults: SAVED_DEFAULTS },
    { model: 'default', effort: 'default' },
  );

  assert.equal(runs.length, 1);
  assert.equal(runs[0].model, 'best');
  assert.equal(runs[0].effort, 'max');
  // The row records what the turn ran with, not the sentinel, so reopening the
  // session does not show "Default" for a turn that used the saved effort.
  assert.equal(session?.model, 'best');
  assert.equal(session?.effort, 'max');
});

test('输入框明确选用 Default 时仍使用供应商默认值', async () => {
  const { runs, session } = await sendOneTurn(
    { savedDefaults: SAVED_DEFAULTS },
    { model: 'default', effort: 'default', explicitModelAndEffort: true },
  );
  assert.equal(runs[0]?.model, 'default');
  assert.equal(runs[0]?.effort, 'default');
  assert.equal(session?.effort, 'default');
});

test('an existing session keeps its recorded model and effort over the saved defaults', async () => {
  const { runs, session } = await sendOneTurn(
    { savedDefaults: SAVED_DEFAULTS, sessionSelection: { model: 'sonnet', effort: 'low' } },
    {},
  );

  assert.equal(runs.length, 1);
  assert.equal(runs[0].model, 'sonnet');
  assert.equal(runs[0].effort, 'low');
  assert.equal(session?.model, 'sonnet');
  assert.equal(session?.effort, 'low');
});

test('an explicit client value still wins over the session record', async () => {
  const { runs, session } = await sendOneTurn(
    { savedDefaults: SAVED_DEFAULTS, sessionSelection: { model: 'sonnet', effort: 'low' } },
    { model: 'opus', effort: 'high' },
  );

  assert.equal(runs[0].model, 'opus');
  assert.equal(runs[0].effort, 'high');
  assert.equal(session?.model, 'opus');
  assert.equal(session?.effort, 'high');
});

test('an explicit model and effort always win over the saved defaults', async () => {
  const { runs } = await sendOneTurn(
    { savedDefaults: SAVED_DEFAULTS },
    { model: 'sonnet', effort: 'low' },
  );

  assert.equal(runs.length, 1);
  assert.equal(runs[0].model, 'sonnet');
  assert.equal(runs[0].effort, 'low');
});

test('saved defaults are read per provider', async () => {
  const { runs } = await sendOneTurn({
    savedDefaults: SAVED_DEFAULTS,
    readChatDefaults: (_userId, provider) => (
      provider === 'claude' ? { claude: { effort: 'medium' } } : SAVED_DEFAULTS
    ),
  });

  assert.equal(runs.length, 1);
  assert.equal(runs[0].effort, 'medium');
  assert.equal(runs[0].model, undefined);
});

test('a user without saved defaults is handed the client options untouched', async () => {
  const { runs, session } = await sendOneTurn({}, { model: 'default', effort: 'default' });

  assert.equal(runs.length, 1);
  assert.equal(runs[0].model, 'default');
  assert.equal(runs[0].effort, 'default');
  assert.equal(session?.effort, 'default');
});
