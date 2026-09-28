import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import { WebSocket, WebSocketServer } from 'ws';

import { handlePluginWsProxy } from '@/modules/websocket/services/plugin-websocket-proxy.service.js';

const PLUGIN = 'identity-echo';
const PLUGIN_KEY = crypto.randomBytes(32);

function createFakeSocket() {
  const socket = new EventEmitter() as EventEmitter & {
    readyState: number;
    frames: string[];
    closes: Array<[number | undefined, string | undefined]>;
    send: (data: unknown) => void;
    close: (code?: number, reason?: string) => void;
  };
  socket.readyState = WebSocket.OPEN;
  socket.frames = [];
  socket.closes = [];
  socket.send = (data: unknown) => socket.frames.push(String(data));
  socket.close = (code?: number, reason?: string) => {
    socket.readyState = WebSocket.CLOSED;
    socket.closes.push([code, reason]);
    socket.emit('close');
  };
  return socket;
}

/** Same signer shape the plugins module exports; a fixed key keeps the test self-contained. */
function buildIdentityHeaders(
  pluginName: string,
  user: { id?: string | number; userId?: string | number; username?: string } | undefined,
): Record<string, string> {
  const userId = user?.userId ?? user?.id;
  if (userId === undefined || pluginName !== PLUGIN) return {};
  const payload = JSON.stringify({ userId, username: user?.username ?? '', iat: Math.floor(Date.now() / 1000) });
  return {
    'x-plugin-user-payload': Buffer.from(payload).toString('base64'),
    'x-plugin-user-signature': `sha256=${crypto.createHmac('sha256', PLUGIN_KEY).update(payload).digest('hex')}`,
    'x-plugin-user-algorithm': 'sha256',
  };
}

function verify(headers: IncomingMessage['headers']): { userId: unknown; username: unknown } | null {
  const payloadB64 = headers['x-plugin-user-payload'];
  const sigHeader = headers['x-plugin-user-signature'];
  if (typeof payloadB64 !== 'string' || typeof sigHeader !== 'string' || headers['x-plugin-user-algorithm'] !== 'sha256') return null;
  const payloadStr = Buffer.from(payloadB64, 'base64').toString('utf8');
  const expected = crypto.createHmac('sha256', PLUGIN_KEY).update(payloadStr).digest();
  const got = Buffer.from(sigHeader.replace(/^sha256=/, ''), 'hex');
  if (got.length !== expected.length || !crypto.timingSafeEqual(got, expected)) return null;
  const payload = JSON.parse(payloadStr);
  return { userId: payload.userId, username: payload.username };
}

/** Upstream plugin websocket: resolves with the upgrade request of the first connection. */
async function startUpstream() {
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise<void>((resolve) => wss.once('listening', resolve));
  const firstConnection = new Promise<IncomingMessage>((resolve) => {
    wss.once('connection', (socket, request) => {
      socket.send(JSON.stringify({ type: 'identity', user: verify(request.headers) }));
      resolve(request);
    });
  });
  return {
    port: (wss.address() as AddressInfo).port,
    firstConnection,
    close: () => new Promise<void>((resolve) => {
      for (const client of wss.clients) client.terminate();
      wss.close(() => resolve());
    }),
  };
}

function waitForFrame(socket: ReturnType<typeof createFakeSocket>) {
  return new Promise<string>((resolve) => {
    const original = socket.send;
    socket.send = (data: unknown) => { original(data); resolve(String(data)); };
  });
}

test('plugin ws proxy signs the authenticated user into the upstream upgrade', async () => {
  const upstream = await startUpstream();
  const client = createFakeSocket();
  try {
    const frame = waitForFrame(client);
    handlePluginWsProxy(client as never, `/plugin-ws/${PLUGIN}`, { userId: 9, username: 'triage' }, {
      getPluginPort: () => upstream.port,
      buildIdentityHeaders,
    });
    const request = await upstream.firstConnection;
    assert.deepEqual(verify(request.headers), { userId: 9, username: 'triage' });
    assert.equal(request.headers.authorization, undefined);
    assert.deepEqual(JSON.parse(await frame), { type: 'identity', user: { userId: 9, username: 'triage' } });
  } finally {
    client.close();
    await upstream.close();
  }
});

test('plugin ws proxy sends no identity headers when the user is absent', async () => {
  const upstream = await startUpstream();
  const client = createFakeSocket();
  try {
    handlePluginWsProxy(client as never, `/plugin-ws/${PLUGIN}`, undefined, {
      getPluginPort: () => upstream.port,
      buildIdentityHeaders,
    });
    const request = await upstream.firstConnection;
    assert.equal(request.headers['x-plugin-user-payload'], undefined);
    assert.equal(request.headers['x-plugin-user-signature'], undefined);
    assert.equal(request.headers['x-plugin-user-algorithm'], undefined);
  } finally {
    client.close();
    await upstream.close();
  }
});

test('plugin ws proxy still rejects unknown plugins before signing or dialing upstream', () => {
  const client = createFakeSocket();
  // The upstream dial only happens after buildIdentityHeaders is evaluated, so
  // "not signed" also means "not dialed".
  let signed = false;
  handlePluginWsProxy(client as never, '/plugin-ws/missing', { userId: 9 }, {
    getPluginPort: () => null,
    buildIdentityHeaders: () => { signed = true; return {}; },
  });
  assert.equal(signed, false);
  assert.deepEqual(client.closes, [[4404, 'Plugin not running']]);
});
