import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import express from 'express';

/**
 * Platform mode has its own sign-in, so CAS must stay off there even with a
 * complete CAS configuration. auth.module.ts reads the environment when it is
 * first imported, hence the dynamic imports (see cas-module-wiring.test.ts).
 */
test('the auth module leaves CAS off in platform mode even when CAS is configured', async () => {
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'cas-module-wiring-platform-'));
  Object.assign(process.env, {
    VITE_IS_PLATFORM: 'true',
    DATABASE_PATH: path.join(tempDirectory, 'auth.db'),
    JWT_SECRET: 'cas-module-wiring-test-secret',
    CAS_SERVER_URL: 'https://cas.example.edu/cas',
    CAS_SERVICE_URL: 'https://cloudcli.example.com/api/auth/cas/callback',
    CAS_ALLOWED_USERS: 'alice',
  });

  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(' '));
  };

  const { closeConnection, initializeDatabase } = await import('@/modules/database/index.js');
  let authRoutes: express.Router;
  try {
    await initializeDatabase();
    ({ authRoutes } = await import('../auth.module.js'));
  } finally {
    console.warn = originalWarn;
  }
  assert.ok(warnings.some((line) => line.includes('[CAS] CAS sign-in is disabled: it is not available in platform mode')));

  const app = express();
  app.use('/api/auth', authRoutes);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const status = await (await fetch(`${baseUrl}/api/auth/status`)).json() as { cas?: unknown };
    assert.deepEqual(status.cas, { enabled: false });
    assert.equal((await fetch(`${baseUrl}/api/auth/cas/login`, { redirect: 'manual' })).status, 404);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    closeConnection();
    await rm(tempDirectory, { recursive: true, force: true });
  }
});
