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
    let duringLookup: (() => void) | undefined;
    let started = false;
    const connection = new FakeConnection();
    handleChatConnection(connection as never, { user: { id: 1 } } as never, {
      runtime: {
        hasRuntime: () => true,
        steer: async () => false,
        askSideQuestion: async () => { throw new Error('This test must not ask a side question.'); },
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
    const restoredBusy = connection.frames.filter((frame) => frame.kind === 'chat_subscribed').at(-1);
    assert.equal(restoredBusy?.isProcessing, true);
    assert.equal(restoredBusy?.external, true);
    assert.equal(connection.frames.at(-2), restoredBusy);
    sessionsService.getExternalSessionActivity = async () => { throw new Error('native lookup failed'); };
    connection.emit('message', Buffer.from(JSON.stringify({ type: 'chat.send', sessionId: 'external-agy-app', content: 'lookup failure', clientSendId: 'ce7df7e5-3a61-47c3-a604-b8b9e52c5852' })));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(started, false);
    assert.equal(connection.frames.at(-1)?.code, 'ACTIVITY_LOOKUP_FAILED');
    assert.equal(connection.frames.at(-1)?.error, 'native lookup failed');
    sessionsDb.createAppSession('healthy-managed', 'claude', directory);
    sessionsService.getExternalSessionActivity = async (id) => {
      if (id === 'external-agy-app') throw new Error('native lookup failed');
      return null;
    };
    const offset = connection.frames.length;
    connection.emit('message', Buffer.from(JSON.stringify({ type: 'chat.subscribe', sessions: [
      { sessionId: 'external-agy-app' }, { sessionId: 'healthy-managed' },
    ] })));
    await new Promise((resolve) => setImmediate(resolve));
    const subscriptions = connection.frames.slice(offset).filter((frame) => frame.kind === 'chat_subscribed');
    assert.deepEqual(subscriptions.map((frame) => frame.sessionId), ['external-agy-app', 'healthy-managed']);
    assert.equal(subscriptions[0].isProcessing, true);
    assert.match(String(subscriptions[0].statusText), /unavailable/);
    assert.equal(subscriptions[1].isProcessing, false);
    sessionsService.getExternalSessionActivity = async () => ({ providerSessionId: 'native-agy', startedAt: 0, canInterrupt: false, unavailable: true });
    connection.emit('message', Buffer.from(JSON.stringify({ type: 'chat.send', sessionId: 'external-agy-app', content: 'blocked', clientSendId: 'ae7df7e5-3a61-47c3-a604-b8b9e52c5852' })));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(started, false);
    assert.match(String(connection.frames.at(-1)?.error), /unavailable/);
    sessionsService.getExternalSessionActivity = async () => { duringLookup?.(); return null; };
    duringLookup = () => {
      chatRunRegistry.startRun({ appSessionId: 'external-agy-app', provider: 'antigravity', providerSessionId: 'native-agy', connection: null, userId: 1 });
    };
    connection.emit('message', Buffer.from(JSON.stringify({ type: 'chat.subscribe', sessions: [{ sessionId: 'external-agy-app', lastSeq: 0 }] })));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(connection.frames.at(-1)?.isProcessing, true);
    chatRunRegistry.clearAll();
    let releaseStartup!: (value: null) => void;
    sessionsService.getExternalSessionActivity = () => new Promise((resolve) => { releaseStartup = resolve; });
    connection.emit('message', Buffer.from(JSON.stringify({ type: 'chat.send', sessionId: 'external-agy-app', content: 'cancel me', clientSendId: 'be7df7e5-3a61-47c3-a604-b8b9e52c5852' })));
    await new Promise((resolve) => setImmediate(resolve));
    const reserved = chatRunRegistry.getRun('external-agy-app');
    assert.ok(reserved);
    // Simulate the registry transition performed by chat.abort while lookup waits.
    chatRunRegistry.completeRunIfCurrent(reserved, { aborted: true, exitCode: 0 });
    releaseStartup(null);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(started, false);
    // A subscribe can be waiting on disk activity when its socket closes and
    // a newer managed run starts. Never retain the closed socket in that run.
    chatRunRegistry.clearAll();
    let finishLookup!: (value: null) => void;
    sessionsService.getExternalSessionActivity = () => new Promise((resolve) => { finishLookup = resolve; });
    const originalAttach = chatRunRegistry.attachConnection;
    let attached = false;
    chatRunRegistry.attachConnection = (...args) => { attached = true; return originalAttach(...args); };
    try {
      connection.emit('message', Buffer.from(JSON.stringify({ type: 'chat.subscribe', sessions: [{ sessionId: 'external-agy-app' }] })));
      connection.readyState = 3;
      connection.emit('close');
      chatRunRegistry.startRun({ appSessionId: 'external-agy-app', provider: 'antigravity', providerSessionId: 'native-agy', connection: null, userId: 1 });
      finishLookup(null);
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(attached, false);
    } finally { chatRunRegistry.attachConnection = originalAttach; }



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
