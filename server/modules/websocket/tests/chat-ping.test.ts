import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';

import { WebSocket, WebSocketServer } from 'ws';

import { handleChatConnection } from '@/modules/websocket/services/chat-websocket.service.js';

test('chat.ping answers its socket without invoking a provider or broadcasting', async (t) => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  t.after(async () => {
    for (const socket of server.clients) socket.terminate();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });
  server.on('connection', (socket, request) => handleChatConnection(socket, request, {
    runtime: {
      hasRuntime: () => assert.fail('ping must not inspect provider runtimes'),
      run: async () => assert.fail('ping must not start a provider'),
      abort: async () => assert.fail('ping must not abort a provider'),
      resolveToolApproval: () => assert.fail('ping must not resolve approvals'),
      getPendingApprovalsForSession: () => assert.fail('ping must not inspect approvals'),
    },
  }));
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const first = new WebSocket(`ws://127.0.0.1:${address.port}`);
  const second = new WebSocket(`ws://127.0.0.1:${address.port}`);
  t.after(() => { first.terminate(); second.terminate(); });
  const secondFrames: unknown[] = [];
  second.on('message', (data) => secondFrames.push(JSON.parse(data.toString())));
  await Promise.all([once(first, 'open'), once(second, 'open')]);

  const firstReply = once(first, 'message');
  first.send(JSON.stringify({ type: 'chat.ping', nonce: 'first-probe' }));
  const [reply] = await firstReply;
  assert.deepEqual(JSON.parse(reply.toString()), { kind: 'pong', nonce: 'first-probe' });

  const secondReply = once(second, 'message');
  second.send(JSON.stringify({ type: 'chat.ping', nonce: 'second-probe' }));
  await secondReply;
  assert.deepEqual(secondFrames, [{ kind: 'pong', nonce: 'second-probe' }]);
});
