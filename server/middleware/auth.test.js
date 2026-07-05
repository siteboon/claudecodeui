import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection } from '../modules/database/connection.js';
import { initializeDatabase } from '../modules/database/init-db.js';
import { userDb } from '../modules/database/repositories/users.js';

async function withIsolatedAuthModule(runTest) {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const previousTrustedProxyAuth = process.env.TRUSTED_PROXY_AUTH;
  const previousTrustedProxyCidrs = process.env.TRUSTED_PROXY_CIDRS;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'auth-proxy-'));
  const databasePath = path.join(tempDirectory, 'auth.db');

  closeConnection();
  process.env.DATABASE_PATH = databasePath;
  process.env.TRUSTED_PROXY_AUTH = 'true';
  delete process.env.TRUSTED_PROXY_CIDRS;
  await initializeDatabase();

  try {
    const auth = await import(`./auth.js?auth-test=${Date.now()}-${Math.random()}`);
    await runTest(auth);
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    if (previousTrustedProxyAuth === undefined) {
      delete process.env.TRUSTED_PROXY_AUTH;
    } else {
      process.env.TRUSTED_PROXY_AUTH = previousTrustedProxyAuth;
    }
    if (previousTrustedProxyCidrs === undefined) {
      delete process.env.TRUSTED_PROXY_CIDRS;
    } else {
      process.env.TRUSTED_PROXY_CIDRS = previousTrustedProxyCidrs;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

function makeRequest(remoteAddress, username = 'sso-user') {
  return {
    socket: { remoteAddress },
    headers: { 'remote-user': username },
  };
}

test('trusted proxy auth provisions the first user from default loopback CIDR', async () => {
  await withIsolatedAuthModule(({ authenticateTrustedProxy }) => {
    const user = authenticateTrustedProxy(makeRequest('127.42.0.10'));

    assert.equal(user?.username, 'sso-user');
    assert.equal(userDb.getFirstUser()?.username, 'sso-user');
  });
});

test('trusted proxy auth honors configured IPv4 CIDR peers', async () => {
  await withIsolatedAuthModule(({ authenticateTrustedProxy }) => {
    process.env.TRUSTED_PROXY_CIDRS = '10.0.0.0/8';

    assert.equal(authenticateTrustedProxy(makeRequest('10.2.3.4'))?.username, 'sso-user');
    assert.equal(authenticateTrustedProxy(makeRequest('192.168.1.10', 'other-user')), null);
  });
});

test('trusted proxy auth preserves single-user invariant', async () => {
  await withIsolatedAuthModule(({ authenticateTrustedProxy }) => {
    authenticateTrustedProxy(makeRequest('127.0.0.1', 'first-user'));

    assert.equal(authenticateTrustedProxy(makeRequest('127.0.0.1', 'second-user')), null);
    assert.equal(authenticateTrustedProxy(makeRequest('127.0.0.1', 'first-user'))?.username, 'first-user');
  });
});
