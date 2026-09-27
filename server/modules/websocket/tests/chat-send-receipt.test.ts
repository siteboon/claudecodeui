import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { chatRunRegistry } from '@/modules/websocket/services/chat-run-registry.service.js';
import { handleChatConnection } from '@/modules/websocket/services/chat-websocket.service.js';
import { connectedClients } from '@/modules/websocket/services/websocket-state.service.js';

class FakeConnection extends EventEmitter {
  readyState = 1;
  frames: Array<Record<string, unknown>> = [];

  send(data: string): void {
    this.frames.push(JSON.parse(data) as Record<string, unknown>);
  }
}

async function withIsolatedDatabase(runTest: () => Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'chat-send-receipt-'));
  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  await initializeDatabase();
  try {
    await runTest();
  } finally {
    connectedClients.clear();
    chatRunRegistry.clearAll();
    closeConnection();
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

test('chat.send acknowledges durable receipt and an identical retry does not rerun', async () => {
  await withIsolatedDatabase(async () => {
    sessionsDb.createAppSession('app-session', 'codex', '/workspace/demo');
    const connection = new FakeConnection();
    let runCount = 0;
    handleChatConnection(connection as never, { user: { id: 1 } } as never, {
      runtime: {
        hasRuntime: () => true,
        run: async () => { runCount += 1; },
        abort: async () => false,
        resolveToolApproval: () => undefined,
        getPendingApprovalsForSession: () => [],
        stopBackgroundTask: async () => false,
        hasBackgroundWork: () => false,
      },
    });

    const payload = JSON.stringify({
      type: 'chat.send',
      sessionId: 'app-session',
      clientSendId: '5e7df7e5-3a61-47c3-a604-b8b9e52c5852',
      content: 'hello',
    });
    connection.emit('message', Buffer.from(payload));
    await new Promise((resolve) => setImmediate(resolve));
    connection.emit('message', Buffer.from(payload));
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(runCount, 1);
    assert.equal(sessionsDb.wasClientSendAccepted('app-session', '5e7df7e5-3a61-47c3-a604-b8b9e52c5852'), true);
    const acknowledgements = connection.frames.filter((frame) => frame.kind === 'chat_send_accepted');
    assert.equal(acknowledgements.length, 2);
    assert.equal(acknowledgements[0]?.duplicate, false);
    assert.equal(acknowledgements[1]?.duplicate, true);
  });
});

test('a delayed frame cannot start a run after its unsent session was discarded', async () => {
  await withIsolatedDatabase(async () => {
    sessionsDb.createAppSession('discarded-session', 'codex', '/workspace/demo');
    assert.equal(sessionsDb.discardUnsentSession('discarded-session'), 'deleted');
    const connection = new FakeConnection();
    let runCount = 0;
    handleChatConnection(connection as never, { user: { id: 1 } } as never, {
      runtime: {
        hasRuntime: () => true,
        run: async () => { runCount += 1; },
        abort: async () => false,
        resolveToolApproval: () => undefined,
        getPendingApprovalsForSession: () => [],
        stopBackgroundTask: async () => false,
        hasBackgroundWork: () => false,
      },
    });

    connection.emit('message', Buffer.from(JSON.stringify({
      type: 'chat.send',
      sessionId: 'discarded-session',
      clientSendId: '5e7df7e5-3a61-47c3-a604-b8b9e52c5852',
      content: 'hello',
    })));
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(runCount, 0);
    assert.equal(connection.frames.find((frame) => frame.kind === 'protocol_error')?.code, 'SESSION_NOT_FOUND');
  });
});
