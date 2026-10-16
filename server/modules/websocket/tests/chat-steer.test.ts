import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type { WebSocket } from 'ws';
import {
  closeConnection,
  initializeDatabase,
  queuedMessagesDb,
  sessionsDb,
  userDb,
} from '@/modules/database/index.js';
import { queuedMessagesService } from '@/modules/scheduled-messages/index.js';
import { handleChatConnection } from '@/modules/websocket/services/chat-websocket.service.js';
import { chatRunRegistry } from '@/modules/websocket/services/chat-run-registry.service.js';
import { connectedClients } from '@/modules/websocket/services/websocket-state.service.js';
import type { ProviderRuntimeGateway } from '@/modules/websocket/services/chat-websocket.service.js';
import type {
  AuthenticatedWebSocketRequest,
  ProviderSteerInput,
} from '@/shared/types.js';

async function gateway(
  run: (context: {
    socket: EventEmitter;
    frames: Record<string, unknown>[];
    userId: number;
    calls: ProviderSteerInput[];
  }) => Promise<void>,
) {
  const previous = process.env.DATABASE_PATH;
  const directory = await mkdtemp(path.join(os.tmpdir(), 'chat-steer-'));
  closeConnection();
  process.env.DATABASE_PATH = path.join(directory, 'auth.db');
  await initializeDatabase();
  const userId = Number(userDb.createUser('steer-user', 'hash').id);
  sessionsDb.createAppSession('session', 'codex', directory, 'Steer');
  const frames: Record<string, unknown>[] = [];
  const socket = Object.assign(new EventEmitter(), {
    readyState: 1,
    send: (frame: string) => frames.push(JSON.parse(frame)),
  });
  const calls: ProviderSteerInput[] = [];
  const runtime: ProviderRuntimeGateway = {
    hasRuntime: () => true,
    run: async () => {
      throw new Error('Steering must not start a run');
    },
    abort: async () => true,
    steer: async (_provider, input) => {
      calls.push(input);
    },
    activeTurnToken: () => 'turn-A',
    stopBackgroundTask: async () => false,
    hasBackgroundWork: () => false,
    resolveToolApproval: () => {},
    getPendingApprovalsForSession: () => [],
  };
  chatRunRegistry.startRun({
    appSessionId: 'session',
    provider: 'codex',
    providerSessionId: 'thread-A',
    connection: socket as unknown as WebSocket,
    userId,
  });
  handleChatConnection(
    socket as unknown as WebSocket,
    { user: { id: userId } } as AuthenticatedWebSocketRequest,
    { runtime },
  );
  try {
    await run({ socket, frames, userId, calls });
  } finally {
    connectedClients.delete(socket as unknown as WebSocket);
    chatRunRegistry.clearAll();
    closeConnection();
    if (previous === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previous;
    await rm(directory, { recursive: true, force: true });
  }
}
async function flush() {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

test('chat.steer consumes the owned queue item and ACKs without replacing or completing the run', async () =>
  gateway(async ({ socket, frames, userId, calls }) => {
    const message = queuedMessagesService.enqueue(userId, {
      id: 'B',
      sessionId: 'session',
      content: 'B',
    });
    const original = chatRunRegistry.getRun('session');
    const request = {
      type: 'chat.steer',
      sessionId: 'session',
      requestId: 'request',
      messageId: 'B',
      revision: message.revision,
      activeTurnToken: 'turn-A',
    };
    socket.emit('message', JSON.stringify(request));
    await flush();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].content, 'B');
    assert.equal(frames.at(-1)?.kind, 'chat_steer_result');
    assert.equal(frames.at(-1)?.status, 'accepted');
    assert.equal(chatRunRegistry.getRun('session'), original);
    assert.equal(original?.status, 'running');
    socket.emit('message', JSON.stringify(request));
    await flush();
    assert.equal(calls.length, 1);
    assert.equal(queuedMessagesDb.list(userId, 'session').length, 0);
  }));

test('unsafe attachments reject steering without consuming the entry or ending the original run', async () =>
  gateway(async ({ socket, frames, userId, calls }) => {
    queuedMessagesService.enqueue(userId, {
      id: 'B',
      sessionId: 'session',
      content: 'B',
      attachments: [{ path: '/etc/passwd' }],
    });
    socket.emit(
      'message',
      JSON.stringify({
        type: 'chat.steer',
        sessionId: 'session',
        requestId: 'request',
        messageId: 'B',
        revision: 1,
        activeTurnToken: 'turn-A',
      }),
    );
    await flush();
    assert.equal(calls.length, 0);
    assert.equal(frames.at(-1)?.status, 'rejected');
    assert.equal(queuedMessagesDb.list(userId, 'session')[0]?.status, 'queued');
    assert.equal(chatRunRegistry.getRun('session')?.status, 'running');
  }));

test('subscribe restores the accepted active turn token and malformed steer gets its own result', async () =>
  gateway(async ({ socket, frames }) => {
    socket.emit(
      'message',
      JSON.stringify({
        type: 'chat.subscribe',
        sessions: [{ sessionId: 'session' }],
      }),
    );
    await flush();
    assert.equal(
      frames.find((frame) => frame.kind === 'chat_subscribed')?.activeTurnToken,
      'turn-A',
    );
    socket.emit(
      'message',
      JSON.stringify({
        type: 'chat.steer',
        sessionId: 'session',
        requestId: 'bad',
      }),
    );
    await flush();
    assert.equal(frames.at(-1)?.kind, 'chat_steer_result');
    assert.equal(frames.at(-1)?.requestId, 'bad');
    assert.equal(chatRunRegistry.getRun('session')?.status, 'running');
  }));
