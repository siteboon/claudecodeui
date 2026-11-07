import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import express from 'express';

process.env.JWT_SECRET = 'test-secret';
process.env.DISABLE_AUTH = 'true';
process.env.VITE_DISABLE_AUTH = 'true';
process.env.VITE_IS_PLATFORM = 'false';

const directory = await mkdtemp(path.join(os.tmpdir(), 'cloudcli-auth-bypass-'));
process.env.DATABASE_PATH = path.join(directory, 'auth.db');

const { initializeDatabase, closeConnection, getConnection, userDb } = await import('../../database/index.js');
await initializeDatabase();
const { authenticateToken, authenticateWebSocket, authRoutes } = await import('../index.js');
const { AppError } = await import('../../../shared/utils.js');

test.beforeEach(() => {
  getConnection().prepare('DELETE FROM users').run();
});

test.after(async () => {
  closeConnection();
  await rm(directory, { recursive: true, force: true });
});

async function withServer(run: (url: string) => Promise<void>) {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  app.get('/protected', authenticateToken, (_req, res) => res.json({ accepted: true }));
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ error: error.message, code: error.code });
      return;
    }
    res.status(500).json({ error: 'Unexpected test error' });
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

test('bypass fails closed for REST, status, registration and WebSocket authentication without a user', async () => {
  assert.equal(authenticateWebSocket(null), null);
  await withServer(async url => {
    const status = await fetch(`${url}/api/auth/status`);
    const registration = await fetch(`${url}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'test-password' }),
    });
    assert.equal(status.status, 503);
    assert.equal(registration.status, 503);
    assert.deepEqual(await registration.json(), await status.json());
    assert.equal((await fetch(`${url}/protected`)).status, 503);
    assert.equal(userDb.hasUsers(), false);
  });
});

test('bypass uses the existing local user without JWTs and preserves single-user registration', async () => {
  userDb.createUser('admin', 'existing-password-hash');
  assert.equal(authenticateWebSocket(null)?.username, 'admin');
  await withServer(async url => {
    const status = await fetch(`${url}/api/auth/status`);
    const payload = await status.json() as {
      needsSetup: boolean;
      isAuthenticated: boolean;
      user: { username: string };
    };
    assert.equal(status.status, 200);
    assert.equal(payload.needsSetup, false);
    assert.equal(payload.isAuthenticated, true);
    assert.equal(payload.user.username, 'admin');
    assert.equal((await fetch(`${url}/protected`)).status, 200);
    const registration = await fetch(`${url}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'another', password: 'test-password' }),
    });
    assert.equal(registration.status, 403);
  });
});
