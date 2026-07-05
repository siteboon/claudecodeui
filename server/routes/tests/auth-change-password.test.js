import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import bcrypt from 'bcrypt';
import express from 'express';

import { closeConnection, initializeDatabase, userDb } from '../../modules/database/index.js';

async function withIsolatedAuthServer(runTest) {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'auth-change-password-'));

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  await initializeDatabase();

  const passwordHash = await bcrypt.hash('old-password', 12);
  const user = userDb.createUser('admin', passwordHash);
  const { generateToken } = await import('../../middleware/auth.js');
  const { default: authRoutes } = await import('../auth.js');

  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const token = generateToken(user);

  try {
    await runTest({ baseUrl, token, userId: Number(user.id) });
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

test('authenticated users can change password only after verifying the current password', async () => {
  await withIsolatedAuthServer(async ({ baseUrl, token, userId }) => {
    const wrongPasswordResponse = await fetch(`${baseUrl}/api/auth/change-password`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        currentPassword: 'wrong-password',
        newPassword: 'new-password',
      }),
    });

    assert.equal(wrongPasswordResponse.status, 401);
    assert.equal(
      await bcrypt.compare('old-password', userDb.getUserWithPasswordById(userId).password_hash),
      true,
    );

    const successResponse = await fetch(`${baseUrl}/api/auth/change-password`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        currentPassword: 'old-password',
        newPassword: 'new-password',
      }),
    });

    assert.equal(successResponse.status, 200);
    assert.deepEqual(await successResponse.json(), { success: true });
    assert.equal(
      await bcrypt.compare('new-password', userDb.getUserWithPasswordById(userId).password_hash),
      true,
    );
  });
});
