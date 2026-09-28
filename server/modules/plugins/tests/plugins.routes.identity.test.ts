import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import express from 'express';

import { createPluginIdentitySigner, derivePluginIdentityKey } from '../plugin-identity.service.js';
import { createPluginsRouter } from '../plugins.routes.js';
import { createPluginsService } from '../plugins.service.js';

const HOST_SECRET = 'route-test-host-secret';
const PLUGIN = 'identity-echo';

type UpstreamCapture = { headers: http.IncomingHttpHeaders; method: string; url: string; body: string };

/** Minimal plugin: records what arrived and echoes the verified identity, RFC-style. */
async function startUpstream(): Promise<{ port: number; captured: UpstreamCapture[]; close: () => Promise<void> }> {
  const captured: UpstreamCapture[] = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      captured.push({ headers: req.headers, method: req.method ?? '', url: req.url ?? '', body });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: (server.address() as AddressInfo).port,
    captured,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

/** Express app that stands in for the host: a fake auth middleware then the plugin router. */
async function startHost(upstreamPort: number, user: { id: number; username: string } | undefined) {
  const service = createPluginsService({
    scanPlugins: () => [], readConfig: () => ({ [PLUGIN]: { secrets: { apiKey: 'shh' } } }),
    saveConfig: () => undefined, getPluginDirectory: () => null, getPluginsDirectory: () => '/plugins',
    resolveAsset: () => null, assetIsFile: () => false, contentType: () => 'text/plain',
    install: async () => ({ name: PLUGIN }), update: async () => ({ name: PLUGIN }),
    uninstall: async () => undefined, startServer: async () => upstreamPort,
    stopServer: async () => undefined, getServerPort: () => upstreamPort, isServerRunning: () => true,
    signIdentity: createPluginIdentitySigner(HOST_SECRET),
    joinPath: (...parts) => parts.join('/'), logError: () => undefined,
  });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as express.Request & { user?: unknown }).user = user; next(); });
  app.use('/api/plugins', createPluginsRouter(service));
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: (server.address() as AddressInfo).port,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function request(port: number, path: string, options: { method?: string; headers?: Record<string, string>; body?: string } = {}) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path, method: options.method ?? 'GET', headers: options.headers }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

function verify(headers: http.IncomingHttpHeaders): { userId: unknown; username: unknown } | null {
  const payloadB64 = headers['x-plugin-user-payload'];
  const sigHeader = headers['x-plugin-user-signature'];
  if (typeof payloadB64 !== 'string' || typeof sigHeader !== 'string' || headers['x-plugin-user-algorithm'] !== 'sha256') return null;
  const payloadStr = Buffer.from(payloadB64, 'base64').toString('utf8');
  const expected = crypto.createHmac('sha256', derivePluginIdentityKey(HOST_SECRET, PLUGIN)).update(payloadStr).digest();
  const got = Buffer.from(sigHeader.replace(/^sha256=/, ''), 'hex');
  if (got.length !== expected.length || !crypto.timingSafeEqual(got, expected)) return null;
  const payload = JSON.parse(payloadStr);
  return { userId: payload.userId, username: payload.username };
}

test('rpc proxy attaches verifiable identity headers for the authenticated user', async () => {
  const upstream = await startUpstream();
  const host = await startHost(upstream.port, { id: 5, username: 'triage' });
  try {
    const response = await request(host.port, `/api/plugins/${PLUGIN}/rpc/whoami?x=1`);
    assert.equal(response.status, 200);
    assert.equal(upstream.captured.length, 1);
    const arrived = upstream.captured[0];
    assert.equal(arrived.url, '/whoami?x=1');
    assert.deepEqual(verify(arrived.headers), { userId: 5, username: 'triage' });
  } finally {
    await host.close();
    await upstream.close();
  }
});

test('rpc proxy strips a query-string session token before forwarding', async () => {
  const upstream = await startUpstream();
  const host = await startHost(upstream.port, { id: 5, username: 'triage' });
  try {
    await request(host.port, `/api/plugins/${PLUGIN}/rpc/whoami?token=secret-jwt&x=1&y=a%20b`);
    await request(host.port, `/api/plugins/${PLUGIN}/rpc/whoami?token=secret-jwt`);
    await request(host.port, `/api/plugins/${PLUGIN}/rpc/whoami?%74oken=secret-jwt&x=1`);
    assert.equal(upstream.captured.length, 3);
    assert.equal(upstream.captured[0].url, '/whoami?x=1&y=a%20b');
    assert.equal(upstream.captured[1].url, '/whoami');
    assert.equal(upstream.captured[2].url, '/whoami?x=1');
    for (const arrived of upstream.captured) {
      assert.ok(!arrived.url.includes('secret-jwt'));
      assert.deepEqual(verify(arrived.headers), { userId: 5, username: 'triage' });
    }
  } finally {
    await host.close();
    await upstream.close();
  }
});

test('rpc proxy never forwards client-supplied x-plugin-user-* headers', async () => {
  const upstream = await startUpstream();
  const host = await startHost(upstream.port, { id: 5, username: 'triage' });
  try {
    const forgedPayload = Buffer.from(JSON.stringify({ userId: 1, username: 'admin', iat: Math.floor(Date.now() / 1000) })).toString('base64');
    await request(host.port, `/api/plugins/${PLUGIN}/rpc/whoami`, {
      headers: {
        'x-plugin-user-payload': forgedPayload,
        'x-plugin-user-signature': 'sha256=deadbeef',
        'x-plugin-user-algorithm': 'none',
        'x-plugin-secret-apikey': 'client-injected',
        authorization: 'Bearer client-token',
      },
    });
    const arrived = upstream.captured[0].headers;
    assert.notEqual(arrived['x-plugin-user-payload'], forgedPayload);
    assert.notEqual(arrived['x-plugin-user-signature'], 'sha256=deadbeef');
    assert.equal(arrived['x-plugin-user-algorithm'], 'sha256');
    assert.equal(arrived.authorization, undefined);
    assert.deepEqual(verify(arrived), { userId: 5, username: 'triage' });
  } finally {
    await host.close();
    await upstream.close();
  }
});

test('rpc proxy sends no identity headers when the request has no user', async () => {
  const upstream = await startUpstream();
  const host = await startHost(upstream.port, undefined);
  try {
    const forgedPayload = Buffer.from(JSON.stringify({ userId: 1, username: 'admin' })).toString('base64');
    const response = await request(host.port, `/api/plugins/${PLUGIN}/rpc/whoami`, {
      headers: { 'x-plugin-user-payload': forgedPayload, 'x-plugin-user-signature': 'sha256=00', 'x-plugin-user-algorithm': 'sha256' },
    });
    assert.equal(response.status, 200);
    const arrived = upstream.captured[0].headers;
    assert.equal(arrived['x-plugin-user-payload'], undefined);
    assert.equal(arrived['x-plugin-user-signature'], undefined);
    assert.equal(arrived['x-plugin-user-algorithm'], undefined);
  } finally {
    await host.close();
    await upstream.close();
  }
});

test('rpc proxy keeps x-plugin-secret-* and content-type behaviour unchanged', async () => {
  const upstream = await startUpstream();
  const host = await startHost(upstream.port, { id: 5, username: 'triage' });
  try {
    const body = JSON.stringify({ hello: 'plugin' });
    const response = await request(host.port, `/api/plugins/${PLUGIN}/rpc/echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)), 'x-plugin-secret-apikey': 'client-injected' },
      body,
    });
    assert.equal(response.status, 200);
    const arrived = upstream.captured[0];
    assert.equal(arrived.method, 'POST');
    assert.equal(arrived.headers['content-type'], 'application/json');
    assert.equal(arrived.headers['x-plugin-secret-apikey'], 'shh');
    assert.deepEqual(JSON.parse(arrived.body), { hello: 'plugin' });

    const defaulted = await request(host.port, `/api/plugins/${PLUGIN}/rpc/plain`);
    assert.equal(defaulted.status, 200);
    assert.equal(upstream.captured[1].headers['content-type'], 'application/json');
  } finally {
    await host.close();
    await upstream.close();
  }
});
