import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import express from 'express';

/**
 * auth.module.ts reads CAS_* (and platform mode) once, when it is first
 * imported, so this file prepares the environment before importing it
 * dynamically. Platform mode is covered by cas-module-wiring-platform.test.ts,
 * because the test runner gives each file its own process.
 */
test('the auth module mounts CAS sign-in when CAS is configured', async () => {
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'cas-module-wiring-'));
  delete process.env.VITE_IS_PLATFORM;
  Object.assign(process.env, {
    DATABASE_PATH: path.join(tempDirectory, 'auth.db'),
    JWT_SECRET: 'cas-module-wiring-test-secret',
    CAS_SERVER_URL: 'https://cas.example.edu/cas',
    CAS_SERVICE_URL: 'https://cloudcli.example.com/api/auth/cas/callback',
    CAS_ALLOWED_USERS: 'alice',
  });

  const { closeConnection, initializeDatabase } = await import('@/modules/database/index.js');
  await initializeDatabase();
  const { authRoutes } = await import('../auth.module.js');

  const app = express();
  app.use('/api/auth', authRoutes);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const status = await (await fetch(`${baseUrl}/api/auth/status`)).json() as { cas?: unknown };
    assert.deepEqual(status.cas, { enabled: true, loginLabel: null });

    const login = await fetch(`${baseUrl}/api/auth/cas/login`, { redirect: 'manual' });
    assert.equal(login.status, 302);
    assert.equal(
      login.headers.get('location'),
      'https://cas.example.edu/cas/login?service=https%3A%2F%2Fcloudcli.example.com%2Fapi%2Fauth%2Fcas%2Fcallback',
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    closeConnection();
    await rm(tempDirectory, { recursive: true, force: true });
  }
});
