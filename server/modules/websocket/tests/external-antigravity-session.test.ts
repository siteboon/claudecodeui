import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { sessionsService } from '@/modules/providers/index.js';
import { chatRunRegistry } from '@/modules/websocket/services/chat-run-registry.service.js';
import { handleChatConnection } from '@/modules/websocket/services/chat-websocket.service.js';
import { connectedClients } from '@/modules/websocket/services/websocket-state.service.js';

class FakeConnection extends EventEmitter {
  readyState = 1;
  frames: Array<Record<string, unknown>> = [];
  send(data: string): void { this.frames.push(JSON.parse(data)); }
}

test('external Antigravity activity survives subscribe and rejects a second prompt', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'external-antigravity-chat-'));
  const previousDatabasePath = process.env.DATABASE_PATH;
  const originalActivity = sessionsService.getExternalSessionActivity;
  closeConnection();
  process.env.DATABASE_PATH = path.join(directory, 'auth.db');
  await initializeDatabase();
  try {
    sessionsDb.createAppSession('external-agy-app', 'antigravity', directory);
    sessionsService.getExternalSessionActivity = async () => ({
      providerSessionId: 'native-agy', provider: 'antigravity', startedAt: 1, lastSeq: 0,
      canInterrupt: false, external: true, statusText: 'Running in the Antigravity CLI',
    });
    let started = false;
    const connection = new FakeConnection();
    handleChatConnection(connection as never, { user: { id: 1 } } as never, {
      runtime: {
        hasRuntime: () => true,
        steer: async () => false,
        askSideQuestion: async () => { throw new Error('Antigravity has no side-question runtime.'); },
        run: async () => { started = true; },
        abort: async () => { throw new Error('Do not signal an interactive AGY process.'); },
        stopBackgroundTask: async () => false,
        hasBackgroundWork: () => false,
        resolveToolApproval: () => {},
        getPendingApprovalsForSession: () => [],
      },
    });
    connection.emit('message', Buffer.from(JSON.stringify({
      type: 'chat.subscribe', sessions: [{ sessionId: 'external-agy-app', lastSeq: 0 }],
    })));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(connection.frames[0]?.isProcessing, true);
    assert.equal(connection.frames[0]?.canInterrupt, false);
    assert.equal(connection.frames[0]?.statusText, 'Running in the Antigravity CLI');

    const clientSendId = '6e7df7e5-3a61-47c3-a604-b8b9e52c5852';
    connection.emit('message', Buffer.from(JSON.stringify({
      type: 'chat.send', sessionId: 'external-agy-app', content: 'follow-up', clientSendId,
    })));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(started, false);
    assert.equal(connection.frames.at(-1)?.code, 'RUN_IN_PROGRESS');
    assert.match(String(connection.frames.at(-1)?.error), /Antigravity/);

  } finally {
    sessionsService.getExternalSessionActivity = originalActivity;
    connectedClients.clear();
    chatRunRegistry.clearAll();
    closeConnection();
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
    await rm(directory, { recursive: true, force: true });
  }
});
