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

const SESSION_ID = 'permission-fallback-session';
const SAVED_PERMISSIONS = {
  allowedTools: ['Bash(sed:*)'],
  disallowedTools: [],
  skipPermissions: true,
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
  readPermissionSettings?: (userId: number, provider: string) => unknown;
  /** Writes this into the saved preferences before connecting. */
  savedPermissions?: unknown;
  userId?: number | null;
};

/**
 * Runs one `chat.send` through the real connection handler and returns the
 * options the provider runtime was handed.
 */
async function sendOneTurn(
  { readPermissionSettings, savedPermissions, userId = 1 }: GatewayOptions,
  clientOptions: AnyRecord = {},
): Promise<AnyRecord[]> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'chat-permissions-'));
  const runs: AnyRecord[] = [];
  const socket = createFakeSocket();

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  await initializeDatabase();

  try {
    if (savedPermissions !== undefined) {
      const { id } = userDb.createUser('permission-tester', 'x');
      userPreferencesDb.savePreferences(Number(id), { claudePermissions: savedPermissions });
    }
    sessionsDb.createAppSession(SESSION_ID, 'claude', tempDirectory);

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
        ...(readPermissionSettings ? { readPermissionSettings } : {}),
      },
    );

    socket.emit('message', JSON.stringify({
      type: 'chat.send',
      sessionId: SESSION_ID,
      content: 'run the task',
      options: clientOptions,
    }));
    await settle();

    return runs;
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

test('a send without toolsSettings runs under the saved permissions', async () => {
  const runs = await sendOneTurn({ savedPermissions: SAVED_PERMISSIONS });

  assert.equal(runs.length, 1);
  assert.deepEqual(runs[0].toolsSettings, SAVED_PERMISSIONS);
});

test('an explicit toolsSettings is never replaced by the saved one', async () => {
  const explicit = { allowedTools: ['Read'], disallowedTools: [], skipPermissions: false };
  const runs = await sendOneTurn(
    {
      savedPermissions: SAVED_PERMISSIONS,
      // Proves the stored copy is not even read when the client sent its own.
      readPermissionSettings: () => { throw new Error('should not be read'); },
    },
    { toolsSettings: explicit },
  );

  assert.equal(runs.length, 1);
  assert.deepEqual(runs[0].toolsSettings, explicit);
});

test('an unreadable preference falls back to the defaults instead of failing the turn', async () => {
  const runs = await sendOneTurn({
    readPermissionSettings: () => { throw new Error('database is gone'); },
  });

  assert.equal(runs.length, 1);
  assert.equal('toolsSettings' in runs[0], false);
});

test('a send with no authenticated user gets no fallback', async () => {
  const runs = await sendOneTurn({
    userId: null,
    readPermissionSettings: () => { throw new Error('should not be read'); },
  });

  assert.equal(runs.length, 1);
  assert.equal('toolsSettings' in runs[0], false);
});
