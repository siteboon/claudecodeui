import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { chatRunRegistry } from '@/modules/websocket/services/chat-run-registry.service.js';
import { handleChatConnection } from '@/modules/websocket/services/chat-websocket.service.js';
import { connectedClients, WS_OPEN_STATE } from '@/modules/websocket/services/websocket-state.service.js';
import type { LLMProvider } from '@/shared/types.js';

class FakeChatSocket extends EventEmitter {
  readyState = WS_OPEN_STATE;
  frames: Array<Record<string, unknown>> = [];

  send(data: string): void {
    this.frames.push(JSON.parse(data) as Record<string, unknown>);
  }
}

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'chat-websocket-'));
  const databasePath = path.join(tempDirectory, 'auth.db');

  closeConnection();
  process.env.DATABASE_PATH = databasePath;
  await initializeDatabase();

  try {
    await runTest();
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

const createNoopDependencies = () => ({
  spawnFns: Object.fromEntries(
    ['claude', 'cursor', 'codex', 'gemini', 'opencode'].map((provider) => [
      provider,
      async () => undefined,
    ]),
  ) as unknown as Record<LLMProvider, (command: string, options: Record<string, unknown>, writer: unknown) => Promise<unknown>>,
  abortFns: Object.fromEntries(
    ['claude', 'cursor', 'codex', 'gemini', 'opencode'].map((provider) => [provider, () => false]),
  ) as unknown as Record<LLMProvider, () => boolean>,
  resolveToolApproval: () => undefined,
  getPendingApprovalsForSession: () => [],
});

test('chat.send passes stable app session id alongside provider resume id', async () => {
  await withIsolatedDatabase(async () => {
    sessionsDb.createAppSession('app-codex-1', 'codex', '/workspace/demo');
    sessionsDb.assignProviderSessionId('app-codex-1', 'codex-native-9');

    let capturedOptions: Record<string, unknown> = {};
    const dependencies = createNoopDependencies();
    dependencies.spawnFns.codex = async (_command, options) => {
      capturedOptions = options;
    };

    const socket = new FakeChatSocket();
    handleChatConnection(socket as never, { user: { id: 'user-1' } } as never, dependencies);
    socket.emit('message', Buffer.from(JSON.stringify({
      type: 'chat.send',
      sessionId: 'app-codex-1',
      content: 'use the selected model',
      options: { model: 'gpt-5.4-mini' },
    })));

    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(capturedOptions?.sessionId, 'codex-native-9');
    assert.equal(capturedOptions?.appSessionId, 'app-codex-1');
  });
});
