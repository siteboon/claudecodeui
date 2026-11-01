import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import express from 'express';

process.env.JWT_SECRET = 'test-secret';
process.env.DISABLE_AUTH = 'true';

const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'cloudcli-auth-bypass-'));
process.env.DATABASE_PATH = path.join(temporaryDirectory, 'auth.db');

const { initializeDatabase, closeConnection, getConnection, userDb } = await import('../modules/database/index.js');
const { authenticateToken, authenticateWebSocket, getLocalBypassUser } = await import('./auth.js');
const { verifyWebSocketClient } = await import('../modules/websocket/services/websocket-auth.service.ts');

await initializeDatabase();

test.beforeEach(() => {
  getConnection().prepare('DELETE FROM users').run();
});

test.after(async () => {
  closeConnection();
  await rm(temporaryDirectory, { recursive: true, force: true });
});

test('authentication bypass fails closed until a local user exists', async () => {
  assert.equal(getLocalBypassUser(), undefined);
  assert.equal(authenticateWebSocket(null), null);

  let statusCode = null;
  let responseBody = null;
  await authenticateToken({}, {
    status(code) {
      statusCode = code;
      return this;
    },
    json(body) {
      responseBody = body;
      return this;
    },
  }, () => assert.fail('middleware must not continue without a local user'));

  assert.equal(statusCode, 503);
  assert.match(responseBody.error, /existing local user/i);
});

test('authentication bypass uses the existing single local user', async () => {
  userDb.createUser('admin', 'existing-password-hash');

  const socketUser = authenticateWebSocket(null);
  assert.equal(socketUser.username, 'admin');

  const request = {};
  let continued = false;
  await authenticateToken(request, {}, () => {
    continued = true;
  });

  assert.equal(continued, true);
  assert.equal(request.user.username, 'admin');
});

test('authentication bypass accepts WebSocket upgrades without a token', () => {
  userDb.createUser('admin', 'existing-password-hash');

  const request = {
    url: '/ws',
    headers: {},
  };

  const accepted = verifyWebSocketClient({ req: request }, {
    isPlatform: false,
    authenticateWebSocket,
  });

  assert.equal(accepted, true);
  assert.equal(request.user.username, 'admin');
});

test('authentication bypass prevents registration without a local user', async (t) => {
  const { default: authRouter } = await import('../routes/auth.js');
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRouter);

  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  }));
  await once(server, 'listening');

  const baseUrl = `http://127.0.0.1:${server.address().port}/api/auth`;
  const statusResponse = await fetch(`${baseUrl}/status`);
  const registrationResponse = await fetch(`${baseUrl}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'test-password' }),
  });

  assert.equal(statusResponse.status, 503);
  assert.equal(registrationResponse.status, 503);
  assert.deepEqual(await registrationResponse.json(), await statusResponse.json());
  assert.equal(userDb.hasUsers(), false);
});
