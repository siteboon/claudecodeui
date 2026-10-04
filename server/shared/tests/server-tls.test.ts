import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import tls from 'node:tls';
import { fileURLToPath } from 'node:url';

import express from 'express';
import { WebSocket } from 'ws';

import { createWebSocketServer } from '@/modules/websocket/index.js';

import { createServerForTls, resolveServerTls } from '../../../shared/serverTls.js';

/**
 * SSL_CERT/SSL_KEY (issue #361) switch the backend to HTTPS on SERVER_PORT. Every other outcome
 * (nothing set, half set, unreadable or broken files) has to keep serving plain HTTP, with a
 * warning that says why whenever the user did try to configure HTTPS.
 *
 * The fixtures are a TEST-ONLY self-signed certificate for `cloudcli-test.invalid` (not
 * 127.0.0.1) and its key, valid until 2126.
 */

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const CERT_PATH = path.join(FIXTURES, 'test-only-tls-cert.pem');
const KEY_PATH = path.join(FIXTURES, 'test-only-tls-key.pem');
const CERT_HOSTNAME = 'cloudcli-test.invalid';

async function withTempDir(run: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'server-tls-'));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function getWarning(result: ReturnType<typeof resolveServerTls>): string {
  assert.equal(result.protocol, 'http');
  assert.ok(result.protocol === 'http' && result.warning, 'expected an HTTP fallback warning');
  return result.warning;
}

test('serves plain HTTP without a warning when neither SSL_CERT nor SSL_KEY is set', () => {
  assert.deepEqual(resolveServerTls({}), { protocol: 'http', warning: null });
  assert.deepEqual(resolveServerTls({ SSL_CERT: '', SSL_KEY: '  ' }), { protocol: 'http', warning: null });
});

test('serves HTTPS with the certificate and key when both files load as a pair', () => {
  const result = resolveServerTls({ SSL_CERT: CERT_PATH, SSL_KEY: KEY_PATH });

  assert.equal(result.protocol, 'https');
  assert.ok(result.protocol === 'https');
  assert.equal(result.certPath, CERT_PATH);
  assert.equal(result.keyPath, KEY_PATH);
  assert.deepEqual(result.cert, fs.readFileSync(CERT_PATH));
  assert.deepEqual(result.key, fs.readFileSync(KEY_PATH));
});

test('resolves relative SSL_CERT/SSL_KEY paths against the working directory', () => {
  const result = resolveServerTls({
    SSL_CERT: path.relative(process.cwd(), CERT_PATH),
    SSL_KEY: path.relative(process.cwd(), KEY_PATH),
  });

  assert.ok(result.protocol === 'https');
  assert.equal(result.certPath, CERT_PATH);
  assert.equal(result.keyPath, KEY_PATH);
});

test('falls back to HTTP and names the missing variable when only one is set', () => {
  const onlyCert = getWarning(resolveServerTls({ SSL_CERT: CERT_PATH }));
  assert.match(onlyCert, /^SSL_KEY is not set/);
  assert.ok(onlyCert.includes(CERT_PATH));

  const onlyKey = getWarning(resolveServerTls({ SSL_KEY: KEY_PATH }));
  assert.match(onlyKey, /^SSL_CERT is not set/);
  assert.ok(onlyKey.includes(KEY_PATH));
});

test('falls back to HTTP and names the variable and path of a file that cannot be read', async () => {
  await withTempDir(async (directory) => {
    const missingCert = path.join(directory, 'missing-cert.pem');
    const certWarning = getWarning(resolveServerTls({ SSL_CERT: missingCert, SSL_KEY: KEY_PATH }));
    assert.match(certWarning, /^SSL_CERT file .* could not be read: ENOENT/);
    assert.ok(certWarning.includes(missingCert));

    const missingKey = path.join(directory, 'missing-key.pem');
    const keyWarning = getWarning(resolveServerTls({ SSL_CERT: CERT_PATH, SSL_KEY: missingKey }));
    assert.match(keyWarning, /^SSL_KEY file .* could not be read: ENOENT/);
    assert.ok(keyWarning.includes(missingKey));

    // A directory is "readable" by stat but not as a file.
    const directoryWarning = getWarning(resolveServerTls({ SSL_CERT: directory, SSL_KEY: KEY_PATH }));
    assert.match(directoryWarning, /^SSL_CERT file .* could not be read: EISDIR/);
  });
});

test('falls back to HTTP when a file is not PEM, without echoing its contents', async () => {
  await withTempDir(async (directory) => {
    const garbagePath = path.join(directory, 'garbage.pem');
    await writeFile(garbagePath, 'not-a-pem-SECRET-MARKER\n');

    const certWarning = getWarning(resolveServerTls({ SSL_CERT: garbagePath, SSL_KEY: KEY_PATH }));
    assert.match(certWarning, /^SSL_CERT file .* is not a usable PEM certificate/);
    assert.ok(certWarning.includes(garbagePath));
    assert.ok(!certWarning.includes('SECRET-MARKER'));

    const keyWarning = getWarning(resolveServerTls({ SSL_CERT: CERT_PATH, SSL_KEY: garbagePath }));
    assert.match(keyWarning, /^SSL_KEY file .* is not a usable unencrypted PEM private key/);
    assert.ok(keyWarning.includes(garbagePath));
    assert.ok(!keyWarning.includes('SECRET-MARKER'));

    // Certificate and key swapped: the key file is not a certificate.
    const swapped = getWarning(resolveServerTls({ SSL_CERT: KEY_PATH, SSL_KEY: CERT_PATH }));
    assert.match(swapped, /^SSL_CERT file .* is not a usable PEM certificate/);
  });
});

test('falls back to HTTP when the key does not belong to the certificate, without printing the key', async () => {
  await withTempDir(async (directory) => {
    const otherKeyPem = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
      .privateKey.export({ type: 'pkcs8', format: 'pem' })
      .toString();
    const otherKeyPath = path.join(directory, 'other-key.pem');
    await writeFile(otherKeyPath, otherKeyPem);

    const warning = getWarning(resolveServerTls({ SSL_CERT: CERT_PATH, SSL_KEY: otherKeyPath }));
    assert.match(warning, /^SSL_KEY file .* does not match SSL_CERT file /);
    assert.ok(warning.includes(otherKeyPath) && warning.includes(CERT_PATH));
    const keyBody = otherKeyPem.split('\n')[1];
    assert.ok(keyBody && !warning.includes(keyBody));
  });
});

test('stays on HTTP without a warning when the desktop app disables SSL for its own server', () => {
  assert.deepEqual(
    resolveServerTls({ SSL_CERT: CERT_PATH, SSL_KEY: KEY_PATH, CLOUDCLI_DISABLE_SSL: '1' }),
    { protocol: 'http', warning: null },
  );
});

/** Mirrors server/index.ts: one server carries both HTTP routes and the WebSocket gateway. */
async function startBackend(env: Record<string, string | undefined>) {
  const serverTls = resolveServerTls(env);
  const app = express();
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });
  const server = createServerForTls(serverTls, app);
  const wss = createWebSocketServer(server, {
    verifyClient: {
      isPlatform: false,
      authenticateWebSocket: (token) => (token === 'good-token' ? { id: 1, username: 'tls-test' } : null),
    },
    chat: { runtime: {} } as unknown as Parameters<typeof createWebSocketServer>[1]['chat'],
    shell: { resolveProviderSessionId: () => null },
    getPluginPort: () => null,
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  return {
    server,
    port,
    async close() {
      for (const client of wss.clients) {
        client.terminate();
      }
      wss.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

function httpsGetJson(port: number, requestPath: string): Promise<{ status: number; body: unknown; peerSubject: string }> {
  return new Promise((resolve, reject) => {
    const request = https.get({
      host: '127.0.0.1',
      port,
      path: requestPath,
      // Full verification: trust only the fixture and check it is the certificate for its name.
      ca: fs.readFileSync(CERT_PATH),
      servername: CERT_HOSTNAME,
      checkServerIdentity: (_host, cert) => tls.checkServerIdentity(CERT_HOSTNAME, cert),
    }, (response) => {
      const peerSubject = (response.socket as tls.TLSSocket).getPeerCertificate().subject.CN;
      let raw = '';
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => {
        raw += chunk;
      });
      response.on('end', () => {
        try {
          resolve({ status: response.statusCode ?? 0, body: JSON.parse(raw), peerSubject });
        } catch (error) {
          reject(error);
        }
      });
    });
    request.on('error', reject);
    request.setTimeout(5000, () => request.destroy(new Error('timeout')));
  });
}

function plainHttpGet(port: number): Promise<string> {
  return new Promise((resolve) => {
    const request = http.get({ host: '127.0.0.1', port, path: '/health' }, (response) => {
      response.resume();
      resolve(`status ${response.statusCode}`);
    });
    request.on('error', (error: NodeJS.ErrnoException) => resolve(`error ${error.code ?? error.message}`));
    request.setTimeout(5000, () => request.destroy(new Error('timeout')));
  });
}

/** Opens a WebSocket and reports how it ended: the plugin path closes with 4404 after the upgrade. */
function openWebSocket(url: string, options: ConstructorParameters<typeof WebSocket>[2] = {}) {
  return new Promise<{ opened: boolean; closeCode: number | null; rejectedStatus: number | null }>((resolve, reject) => {
    const socket = new WebSocket(url, { handshakeTimeout: 5000, ...options });
    let opened = false;
    socket.on('open', () => {
      opened = true;
    });
    socket.on('close', (code) => resolve({ opened, closeCode: code, rejectedStatus: null }));
    socket.on('unexpected-response', (_request, response) => {
      resolve({ opened, closeCode: null, rejectedStatus: response.statusCode ?? null });
      socket.terminate();
    });
    socket.on('error', (error) => {
      if (!opened) {
        reject(error);
      }
    });
  });
}

test('the backend serves HTTPS and authenticated WSS upgrades on one port when SSL is configured', { timeout: 20_000 }, async (t) => {
  const backend = await startBackend({ SSL_CERT: CERT_PATH, SSL_KEY: KEY_PATH });
  t.after(() => backend.close());
  assert.ok(backend.server instanceof https.Server);

  const health = await httpsGetJson(backend.port, '/health');
  assert.equal(health.status, 200);
  assert.deepEqual(health.body, { status: 'ok' });
  assert.equal(health.peerSubject, CERT_HOSTNAME);

  // Plain HTTP on the same port gets no response from a TLS listener.
  assert.match(await plainHttpGet(backend.port), /^error /);

  const tlsOptions = { ca: fs.readFileSync(CERT_PATH), servername: CERT_HOSTNAME };
  const upgraded = await openWebSocket(`wss://127.0.0.1:${backend.port}/plugin-ws/demo?token=good-token`, tlsOptions);
  assert.deepEqual(upgraded, { opened: true, closeCode: 4404, rejectedStatus: null });

  const unauthenticated = await openWebSocket(`wss://127.0.0.1:${backend.port}/plugin-ws/demo?token=bad`, tlsOptions);
  assert.deepEqual(unauthenticated, { opened: false, closeCode: null, rejectedStatus: 401 });
});

test('the backend keeps serving plain HTTP and ws:// when SSL is not configured', { timeout: 20_000 }, async (t) => {
  const backend = await startBackend({});
  t.after(() => backend.close());
  assert.ok(!(backend.server instanceof tls.Server));
  assert.equal(await plainHttpGet(backend.port), 'status 200');

  const upgraded = await openWebSocket(`ws://127.0.0.1:${backend.port}/plugin-ws/demo?token=good-token`);
  assert.deepEqual(upgraded, { opened: true, closeCode: 4404, rejectedStatus: null });
});

test('a broken SSL configuration still starts a working plain HTTP backend', { timeout: 20_000 }, async (t) => {
  const backend = await startBackend({ SSL_CERT: CERT_PATH });
  t.after(() => backend.close());
  assert.ok(!(backend.server instanceof tls.Server));
  assert.equal(await plainHttpGet(backend.port), 'status 200');
});
