import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import { WebSocket } from 'ws';

import { createMachinesService } from '@/modules/machines/index.js';

import { createWorkerConnectionRegistry } from '../services/worker-connection.service.js';

class FakeSocket extends EventEmitter {
  readyState: typeof WebSocket.OPEN = WebSocket.OPEN;
  sent: string[] = [];

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = WebSocket.CLOSED as typeof WebSocket.OPEN;
    this.emit('close');
  }
}

test('worker ping/pong echo resolves with latency', async () => {
  const machinesService = createMachinesService({
    createId: () => 'machine-1',
    generateToken: () => 'mw_abc',
    hashToken: (token) => token,
    createMachine: ({ id, name, tokenPrefix }) => ({
      id,
      name,
      tokenHash: 'mw_abc',
      tokenPrefix,
      status: 'offline',
      lastSeenAt: null,
      hostname: null,
      createdAt: 'now',
      revokedAt: null,
    }),
    listMachines: () => [],
    getMachineById: () => ({
      id: 'machine-1',
      name: 'box',
      tokenHash: 'mw_abc',
      tokenPrefix: 'mw_abc',
      status: 'online',
      lastSeenAt: null,
      hostname: null,
      createdAt: 'now',
      revokedAt: null,
    }),
    findActiveMachineByToken: () => ({
      id: 'machine-1',
      name: 'box',
      tokenHash: 'mw_abc',
      tokenPrefix: 'mw_abc',
      status: 'offline',
      lastSeenAt: null,
      hostname: null,
      createdAt: 'now',
      revokedAt: null,
    }),
    renameMachine: () => null,
    revokeMachine: () => true,
    markOnline: () => ({
      id: 'machine-1',
      name: 'box',
      tokenHash: 'mw_abc',
      tokenPrefix: 'mw_abc',
      status: 'online',
      lastSeenAt: null,
      hostname: null,
      createdAt: 'now',
      revokedAt: null,
    }),
    markOffline: () => ({
      id: 'machine-1',
      name: 'box',
      tokenHash: 'mw_abc',
      tokenPrefix: 'mw_abc',
      status: 'offline',
      lastSeenAt: null,
      hostname: null,
      createdAt: 'now',
      revokedAt: null,
    }),
    touchHeartbeat: () => undefined,
  });

  const registry = createWorkerConnectionRegistry({
    machinesService,
    createRequestId: () => 'req-1',
    pingTimeoutMs: 1000,
  });

  const socket = new FakeSocket();
  registry.handleConnection(socket as never, {
    machine: { id: 'machine-1', name: 'box' },
  } as never);

  const welcome = JSON.parse(socket.sent[0]);
  assert.equal(welcome.type, 'worker.welcome');

  const pingPromise = registry.pingMachine('machine-1');
  const pingMessage = JSON.parse(socket.sent[1]);
  assert.equal(pingMessage.type, 'worker.ping');
  assert.equal(pingMessage.requestId, 'req-1');

  socket.emit('message', Buffer.from(JSON.stringify({
    type: 'worker.pong',
    requestId: 'req-1',
    payload: pingMessage.payload,
  })));

  const result = await pingPromise;
  assert.equal(result.ok, true);
  assert.equal(result.payload, pingMessage.payload);
  assert.ok(result.latencyMs >= 0);
});
