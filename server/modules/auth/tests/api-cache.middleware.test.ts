import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import express from 'express';

import { noStoreApiResponses } from '../api-cache.middleware.js';

type Reply = { status: number; headers: http.IncomingHttpHeaders };

function request(baseUrl: string, path: string, headers: http.OutgoingHttpHeaders = {}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    http
      .get(`${baseUrl}${path}`, { headers }, (res) => {
        res.resume();
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers }));
      })
      .on('error', reject);
  });
}

// `protect` false builds the app the way server/index.ts built it before this
// change, so each test can show the behaviour it guards against.
async function withServer(protect: boolean, run: (baseUrl: string) => Promise<void>): Promise<void> {
  const app = express();
  if (protect) {
    app.set('etag', false);
    app.use('/api', noStoreApiResponses);
  }
  app.get('/api/user/onboarding-status', (_req, res) => {
    res.setHeader('X-Refreshed-Token', 'token-from-this-response');
    res.json({ needsSetup: false });
  });
  app.get('/api/auth/user', (_req, res) => {
    res.setHeader('X-Auth-Error', 'invalid-token');
    res.status(401).json({ error: 'Invalid token' });
  });
  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

test('without the middleware an API response is cacheable and revalidates to 304', async () => {
  await withServer(false, async (baseUrl) => {
    const first = await request(baseUrl, '/api/user/onboarding-status');
    assert.equal(first.headers['cache-control'], undefined);
    assert.ok(first.headers.etag, 'express attaches a weak ETag by default');

    const revalidated = await request(baseUrl, '/api/user/onboarding-status', {
      'If-None-Match': first.headers.etag as string,
    });
    assert.equal(revalidated.status, 304);
  });
});

test('API responses are marked no-store and carry no ETag', async () => {
  await withServer(true, async (baseUrl) => {
    const reply = await request(baseUrl, '/api/user/onboarding-status');

    assert.equal(reply.status, 200);
    assert.equal(reply.headers['cache-control'], 'no-store');
    assert.equal(reply.headers.etag, undefined);
    assert.equal(reply.headers['x-refreshed-token'], 'token-from-this-response');
  });
});

test('a conditional request to the API is answered in full, never with 304', async () => {
  // The validator a browser would still hold from before the upgrade.
  let staleEtag = '';
  await withServer(false, async (baseUrl) => {
    staleEtag = (await request(baseUrl, '/api/user/onboarding-status')).headers.etag as string;
  });

  await withServer(true, async (baseUrl) => {
    const reply = await request(baseUrl, '/api/user/onboarding-status', { 'If-None-Match': staleEtag });

    assert.equal(reply.status, 200);
    assert.equal(reply.headers['x-refreshed-token'], 'token-from-this-response');
  });
});

test('a 401 with X-Auth-Error is not cacheable either', async () => {
  await withServer(true, async (baseUrl) => {
    const reply = await request(baseUrl, '/api/auth/user');

    assert.equal(reply.status, 401);
    assert.equal(reply.headers['cache-control'], 'no-store');
    assert.equal(reply.headers.etag, undefined);
  });
});

test('responses outside /api are left alone', async () => {
  await withServer(true, async (baseUrl) => {
    const reply = await request(baseUrl, '/health');

    assert.equal(reply.status, 200);
    assert.equal(reply.headers['cache-control'], undefined);
  });
});
