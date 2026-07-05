import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import { WebSocket } from 'ws';

import {
  handlePtySessionSocketClose,
  terminatePtySession,
} from '@/modules/websocket/services/shell-websocket.service.js';
import { attachWebSocketHeartbeat } from '@/modules/websocket/services/websocket-server.service.js';

class FakeWebSocket extends EventEmitter {
  readyState: number = WebSocket.OPEN;
  pingCalls = 0;
  terminateCalls = 0;

  ping(): void {
    this.pingCalls += 1;
  }

  terminate(): void {
    this.terminateCalls += 1;
    this.readyState = WebSocket.CLOSED;
    this.emit('close');
  }

  close(): void {
    this.readyState = WebSocket.CLOSED;
    this.emit('close');
  }
}

function asWebSocket(ws: FakeWebSocket): WebSocket {
  return ws as unknown as WebSocket;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const TEST_HEARTBEAT_INTERVAL_MS = 20;
const TEST_GRACE_TIMEOUT_MS = 25;

function makeSession(ws: FakeWebSocket) {
  let killCalls = 0;
  const session = {
    pty: {
      kill: () => {
        killCalls += 1;
      },
    },
    ws: asWebSocket(ws),
    buffer: [],
    timeoutId: null,
    projectPath: '/tmp/project',
    sessionId: 'session-1',
  };

  return {
    session,
    getKillCalls: () => killCalls,
  };
}

test('websocket heartbeat terminates a connection that misses a pong', async () => {
  const ws = new FakeWebSocket();

  attachWebSocketHeartbeat(asWebSocket(ws), TEST_HEARTBEAT_INTERVAL_MS);
  await delay(30);

  assert.equal(ws.pingCalls, 1);
  assert.equal(ws.terminateCalls, 0);

  await delay(30);

  assert.equal(ws.terminateCalls, 1);
});

test('websocket heartbeat keeps a connection alive when a pong arrives', async () => {
  const ws = new FakeWebSocket();
  ws.ping = () => {
    ws.pingCalls += 1;
    ws.emit('pong');
  };

  attachWebSocketHeartbeat(asWebSocket(ws), TEST_HEARTBEAT_INTERVAL_MS);
  await delay(65);

  assert.equal(ws.terminateCalls, 0);
  assert.ok(ws.pingCalls >= 2);

  ws.close();
});

test('stale shell socket close does not detach the current shell socket', async () => {
  const staleWs = new FakeWebSocket();
  const currentWs = new FakeWebSocket();
  const { session, getKillCalls } = makeSession(currentWs);
  const sessionsMap = new Map([['shell-key', session]]);

  const detached = handlePtySessionSocketClose(
    session as never,
    asWebSocket(staleWs),
    'shell-key',
    sessionsMap as never,
    TEST_GRACE_TIMEOUT_MS,
  );

  assert.equal(detached, false);
  assert.equal(session.ws, asWebSocket(currentWs));
  await delay(35);
  assert.equal(getKillCalls(), 0);
  assert.equal(sessionsMap.has('shell-key'), true);
});

test('shell socket close keeps a reattached PTY session alive', async () => {
  const closingWs = new FakeWebSocket();
  const reattachedWs = new FakeWebSocket();
  const { session, getKillCalls } = makeSession(closingWs);
  const sessionsMap = new Map([['shell-key', session]]);

  const detached = handlePtySessionSocketClose(
    session as never,
    asWebSocket(closingWs),
    'shell-key',
    sessionsMap as never,
    TEST_GRACE_TIMEOUT_MS,
  );

  assert.equal(detached, true);
  assert.equal(session.ws, null);

  session.ws = asWebSocket(reattachedWs);
  await delay(35);

  assert.equal(getKillCalls(), 0);
  assert.equal(sessionsMap.has('shell-key'), true);
  assert.equal(session.timeoutId, null);
});

test('shell socket close removes an unattached PTY session after the grace timeout', async () => {
  const closingWs = new FakeWebSocket();
  const { session, getKillCalls } = makeSession(closingWs);
  const sessionsMap = new Map([['shell-key', session]]);

  const detached = handlePtySessionSocketClose(
    session as never,
    asWebSocket(closingWs),
    'shell-key',
    sessionsMap as never,
    TEST_GRACE_TIMEOUT_MS,
  );

  assert.equal(detached, true);
  await delay(35);

  assert.equal(getKillCalls(), 1);
  assert.equal(sessionsMap.has('shell-key'), false);
  assert.equal(session.timeoutId, null);
});

test('explicit shell termination kills and removes the PTY session immediately', () => {
  const closingWs = new FakeWebSocket();
  const { session, getKillCalls } = makeSession(closingWs);
  const sessionsMap = new Map([['shell-key', session]]);

  const terminated = terminatePtySession(
    session as never,
    'shell-key',
    sessionsMap as never,
  );

  assert.equal(terminated, true);
  assert.equal(getKillCalls(), 1);
  assert.equal(sessionsMap.has('shell-key'), false);
  assert.equal(session.ws, null);
});
