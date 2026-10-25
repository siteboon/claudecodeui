import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import test from 'node:test';

import express from 'express';

import {
  attachConnectionGuard,
  createLoginRateLimiter,
  isAllowedAddress,
  isLoopbackAddress,
  isRemoteEnabled,
  isTailscaleAddress,
  registerFromLoopbackOnly,
} from '@/modules/remote-access/remote-access.js';

test('address classification: loopback, tailscale, everything else', () => {
  for (const address of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) assert.equal(isLoopbackAddress(address), true, address);
  for (const address of ['100.64.0.1', '100.100.1.2', '100.127.255.254', '::ffff:100.101.102.103', 'fd7a:115c:a1e0::1']) {
    assert.equal(isTailscaleAddress(address), true, address);
  }
  for (const address of ['100.63.255.255', '100.128.0.1', '192.168.1.20', '10.0.0.5', '8.8.8.8', '', 'fd00::1', undefined]) {
    assert.equal(isTailscaleAddress(address as string), false, String(address));
    assert.equal(isAllowedAddress(address as string, true), false, String(address));
  }
});

test('remote mode is opt-in: tailscale addresses are refused unless enabled', () => {
  assert.equal(isRemoteEnabled({}), false);
  assert.equal(isRemoteEnabled({ WORKBENCH_REMOTE: '1' }), true);
  assert.equal(isAllowedAddress('100.100.1.2', false), false);
  assert.equal(isAllowedAddress('100.100.1.2', true), true);
  assert.equal(isAllowedAddress('127.0.0.1', false), true);
});

test('connection guard drops non-allowed sockets before HTTP handling', () => {
  const listeners: Array<(socket: net.Socket) => void> = [];
  const fakeServer = { on: (_event: 'connection', listener: (socket: net.Socket) => void) => { listeners.push(listener); } };
  const socketFrom = (address: string, destroyed: string[]) =>
    ({ remoteAddress: address, destroy: () => destroyed.push(address) }) as unknown as net.Socket;

  attachConnectionGuard(fakeServer, false);
  const destroyedOff: string[] = [];
  for (const address of ['127.0.0.1', '::1', '192.168.1.50', '100.100.1.2']) listeners[0](socketFrom(address, destroyedOff));
  assert.deepEqual(destroyedOff, ['192.168.1.50', '100.100.1.2'], 'remote off: only loopback survives');

  attachConnectionGuard(fakeServer, true);
  const destroyedOn: string[] = [];
  for (const address of ['127.0.0.1', '192.168.1.50', '100.100.1.2', '8.8.8.8']) listeners[1](socketFrom(address, destroyedOn));
  assert.deepEqual(destroyedOn, ['192.168.1.50', '8.8.8.8'], 'remote on: loopback and tailscale survive, LAN and internet dropped');
});

test('login throttle: 5 failures per IP then 429 with Retry-After; success clears; window expires', async () => {
  let clock = 1_000_000;
  const app = express();
  app.use(express.json());
  app.post('/login', createLoginRateLimiter({ now: () => clock }), (req, res) => {
    if (req.body.password === 'right') res.json({ ok: true });
    else res.status(401).json({ error: 'bad' });
  });
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as net.AddressInfo).port;
  const post = (password: string) => fetch(`http://127.0.0.1:${port}/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password }),
  });

  for (let i = 0; i < 4; i += 1) assert.equal((await post('wrong')).status, 401);
  assert.equal((await post('right')).status, 200, 'success before the limit clears the counter');
  for (let i = 0; i < 5; i += 1) assert.equal((await post('wrong')).status, 401);
  const blocked = await post('right');
  assert.equal(blocked.status, 429, 'even the right password is refused while throttled');
  assert.ok(Number(blocked.headers.get('retry-after')) > 0);
  clock += 16 * 60_000;
  assert.equal((await post('right')).status, 200, 'window expired');
  server.close();
  server.closeAllConnections();
});

test('registration is refused for non-loopback peers', () => {
  const calls: string[] = [];
  const reply = { status(code: number) { calls.push(`status:${code}`); return this; }, json() { calls.push('json'); } };
  registerFromLoopbackOnly({ socket: { remoteAddress: '100.100.1.2' } } as never, reply as never, () => calls.push('next'));
  assert.deepEqual(calls, ['status:403', 'json']);
  const ok: string[] = [];
  registerFromLoopbackOnly({ socket: { remoteAddress: '::ffff:127.0.0.1' } } as never, reply as never, () => ok.push('next'));
  assert.deepEqual(ok, ['next']);
});
