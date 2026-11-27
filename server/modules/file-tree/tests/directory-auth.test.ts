import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import express from 'express';


import { createFileTreeRouter } from '@/modules/file-tree/file-tree.routes.js';
import type { FileTreeServices } from '@/shared/types.js';

// The release has no @types/jsonwebtoken; type only the signing operation this test needs.
const jwt = createRequire(import.meta.url)('jsonwebtoken') as { sign(payload: { userId: number }, secret: string): string };

test('directory route uses real authentication: absent/invalid/unknown-user tokens cannot list', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'sidebar-auth-'));
  const previous = { database: process.env.DATABASE_PATH, jwt: process.env.JWT_SECRET, platform: process.env.VITE_IS_PLATFORM };
  process.env.DATABASE_PATH = path.join(directory, 'auth.db');
  process.env.JWT_SECRET = 'isolated-sidebar-test-secret';
  process.env.VITE_IS_PLATFORM = 'false';
  const db = await import('@/modules/database/index.js');
  await db.initializeDatabase();
  const { authenticateToken } = await import('@/modules/auth/index.js');
  let calls = 0;
  const services = { listProjectDirectory: async () => { calls++; return { entries: [], nextCursor: null, path: '/test' }; } } as unknown as FileTreeServices;
  const app = express();
  app.use('/api/file-tree', authenticateToken, createFileTreeRouter(services, (_req, _res, next) => next(),
    { maximumFileSizeMegabytes: 1, maximumFileCount: 1 }, { error: () => {} }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/file-tree/projects/p/directory`;
  try {
    assert.equal((await fetch(url)).status, 401);
    assert.equal((await fetch(url, { headers: { Authorization: 'Bearer invalid' } })).status, 401);
    const unknown = jwt.sign({ userId: 999999 }, process.env.JWT_SECRET!);
    assert.equal((await fetch(url, { headers: { Authorization: `Bearer ${unknown}` } })).status, 401);
    assert.equal(calls, 0);
    const user = db.userDb.createUser('sidebar-test', 'not-a-live-password-hash');
    const token = jwt.sign({ userId: Number(user.id) }, process.env.JWT_SECRET!);
    assert.equal((await fetch(url, { headers: { Authorization: `Bearer ${token}` } })).status, 200);
    assert.equal(calls, 1);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.closeConnection();
    for (const [key, value] of Object.entries({ DATABASE_PATH: previous.database, JWT_SECRET: previous.jwt, VITE_IS_PLATFORM: previous.platform })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await rm(directory, { recursive: true, force: true });
  }
});
