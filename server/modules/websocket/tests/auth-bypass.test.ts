import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type { AuthenticatedWebSocketRequest } from '@/shared/types.js';

import { verifyWebSocketClient } from '../services/websocket-auth.service.js';

process.env.JWT_SECRET = 'test-secret';
process.env.DISABLE_AUTH = 'true';
process.env.VITE_DISABLE_AUTH = 'true';
process.env.VITE_IS_PLATFORM = 'false';
const directory = await mkdtemp(path.join(os.tmpdir(), 'cloudcli-socket-bypass-'));
process.env.DATABASE_PATH = path.join(directory, 'auth.db');
const { initializeDatabase, closeConnection, userDb } = await import('../../database/index.js');
await initializeDatabase();
const { authenticateWebSocket } = await import('../../auth/index.js');

test.after(async () => {
  closeConnection();
  await rm(directory, { recursive: true, force: true });
});

test('tokenless chat and shell upgrades use real bypass authentication and fail closed before setup', () => {
  const verify = (url: string, isPlatform: boolean) => {
    const req = { url, headers: {} } as AuthenticatedWebSocketRequest;
    const accepted = verifyWebSocketClient({ req, origin: '', secure: false }, { isPlatform, authenticateWebSocket });
    return { accepted, user: req.user };
  };
  for (const isPlatform of [false, true]) {
    for (const url of ['/ws', '/shell']) assert.equal(verify(url, isPlatform).accepted, false);
  }
  userDb.createUser('admin', 'existing-password-hash');
  for (const isPlatform of [false, true]) {
    for (const url of ['/ws', '/shell']) {
      const result = verify(url, isPlatform);
      assert.equal(result.accepted, true);
      assert.equal(result.user?.username, 'admin');
    }
  }
});
