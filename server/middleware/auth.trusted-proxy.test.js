/**
 * Unit tests for trusted reverse-proxy header authentication helpers.
 *
 * Focus: the anti-spoofing boundary — a trusted identity header is only honoured when
 * the request's *direct* source IP (socket peer, never X-Forwarded-For) falls within
 * TRUSTED_PROXY_CIDRS, so a client reaching the app directly cannot forge an identity.
 *
 * Run: TSX_TSCONFIG_PATH=server/tsconfig.json node --import tsx --test \
 *      server/middleware/auth.trusted-proxy.test.js
 * (the server tsconfig is needed so the `@/` alias resolves when the database module loads)
 */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

// Pin a JWT secret + proxy config before import so loading the module is side-effect
// free (does not generate a secret via the database) and reads a known CIDR set.
process.env.JWT_SECRET = 'test-secret';
process.env.TRUSTED_PROXY_AUTH = 'true';
process.env.TRUSTED_PROXY_CIDRS = '127.0.0.0/8,::1/128,10.0.0.0/8';

const { cidrMatch, isFromTrustedProxy, resolveTrustedProxyUser } = await import('./auth.js');
const { userDb } = await import('../modules/database/index.js');
const { initializeDatabase } = await import('../modules/database/init-db.js');
const { closeConnection } = await import('../modules/database/connection.js');

// Default identity header is 'Remote-User'; Node lowercases request header keys.
const USER_HEADER = 'remote-user';
// A source inside TRUSTED_PROXY_CIDRS (10.0.0.0/8) — stands in for the reverse proxy.
const trustedReq = (headers = {}) => ({ socket: { remoteAddress: '10.0.0.5' }, headers });

// Run a test body against a throwaway SQLite database so user-provisioning side
// effects never leak between cases (mirrors the sessions.db integration harness).
async function withIsolatedDatabase(runTest) {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'trusted-proxy-'));
  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  await initializeDatabase();
  try {
    await runTest();
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

test('cidrMatch: IPv4 prefix matching', () => {
  assert.equal(cidrMatch('127.0.0.1', '127.0.0.0/8'), true);
  assert.equal(cidrMatch('10.1.2.3', '10.0.0.0/8'), true);
  assert.equal(cidrMatch('192.168.1.1', '10.0.0.0/8'), false);
  assert.equal(cidrMatch('11.0.0.1', '10.0.0.0/8'), false);
});

test('cidrMatch: /32 host and exact address', () => {
  assert.equal(cidrMatch('203.0.113.5', '203.0.113.5/32'), true);
  assert.equal(cidrMatch('203.0.113.6', '203.0.113.5/32'), false);
});

test('cidrMatch: IPv6 loopback exact match (no IPv4 cross-match)', () => {
  assert.equal(cidrMatch('::1', '::1/128'), true);
  assert.equal(cidrMatch('fe80::1', '::1/128'), false);
  assert.equal(cidrMatch('127.0.0.1', '::1/128'), false);
});

test('isFromTrustedProxy: trusts allow-listed source, rejects others', () => {
  assert.equal(isFromTrustedProxy({ socket: { remoteAddress: '127.0.0.1' } }), true);
  assert.equal(isFromTrustedProxy({ socket: { remoteAddress: '10.9.9.9' } }), true);
  // IPv4-mapped IPv6 is unwrapped before matching.
  assert.equal(isFromTrustedProxy({ socket: { remoteAddress: '::ffff:127.0.0.1' } }), true);
  // A client reaching the app directly from outside the trusted range is rejected.
  assert.equal(isFromTrustedProxy({ socket: { remoteAddress: '203.0.113.9' } }), false);
});

test('resolveTrustedProxyUser: provisions the first user from the proxy identity', async () => {
  await withIsolatedDatabase(() => {
    assert.equal(userDb.hasUsers(), false);
    const user = resolveTrustedProxyUser(trustedReq({ [USER_HEADER]: 'alice' }));
    assert.ok(user, 'expected a provisioned user');
    assert.equal(user.username, 'alice');
    assert.equal(typeof user.id, 'number');
    assert.equal(userDb.hasUsers(), true);
  });
});

test('resolveTrustedProxyUser: returns the existing user without creating a duplicate', async () => {
  await withIsolatedDatabase(() => {
    const created = resolveTrustedProxyUser(trustedReq({ [USER_HEADER]: 'alice' }));
    const again = resolveTrustedProxyUser(trustedReq({ [USER_HEADER]: 'alice' }));
    assert.ok(again);
    assert.equal(again.id, created.id);
    assert.equal(again.username, 'alice');
  });
});

test('resolveTrustedProxyUser: enforces the single-user invariant for a different identity', async () => {
  await withIsolatedDatabase(() => {
    const first = resolveTrustedProxyUser(trustedReq({ [USER_HEADER]: 'alice' }));
    assert.ok(first);
    // A second, different proxy identity must be refused once an account exists.
    assert.equal(resolveTrustedProxyUser(trustedReq({ [USER_HEADER]: 'bob' })), null);
    // The original user is still resolvable and was not displaced.
    assert.equal(resolveTrustedProxyUser(trustedReq({ [USER_HEADER]: 'alice' })).id, first.id);
  });
});

test('resolveTrustedProxyUser: ignores absent or non-string identity headers', async () => {
  await withIsolatedDatabase(() => {
    // Header absent — nothing to vouch for.
    assert.equal(resolveTrustedProxyUser(trustedReq({})), null);
    // Duplicate header arrives as an array (non-string) and must not be trusted.
    assert.equal(resolveTrustedProxyUser(trustedReq({ [USER_HEADER]: ['alice', 'bob'] })), null);
    // No user should have been provisioned from a rejected header.
    assert.equal(userDb.hasUsers(), false);
  });
});

test('resolveTrustedProxyUser: ignores a valid identity header from an untrusted source', async () => {
  await withIsolatedDatabase(() => {
    const req = { socket: { remoteAddress: '203.0.113.9' }, headers: { [USER_HEADER]: 'alice' } };
    assert.equal(resolveTrustedProxyUser(req), null);
    assert.equal(userDb.hasUsers(), false);
  });
});
