import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import {
  createPluginIdentitySigner,
  derivePluginIdentityKey,
  signPluginUserIdentity,
} from '../plugin-identity.service.js';

const HOST_SECRET = 'host-secret-that-never-leaves-the-host';

/**
 * Plugin-side verifier copied from the RFC (issue #744) / docs/plugins/identity.md.
 * Kept verbatim here so the host's signer is proven against what plugins ship.
 */
function verifyPluginIdentity(
  headers: Record<string, string | undefined>,
  pluginKeyHex: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): { userId: string | number; username: string } | null {
  const payloadB64 = headers['x-plugin-user-payload'];
  const sigHeader = headers['x-plugin-user-signature'];
  const algo = headers['x-plugin-user-algorithm'];
  if (!payloadB64 || !sigHeader || algo !== 'sha256') return null;

  const [scheme, sigHex] = String(sigHeader).split('=');
  if (scheme !== 'sha256' || !sigHex) return null;

  if (String(payloadB64).length > 8192) return null;

  const payloadStr = Buffer.from(payloadB64, 'base64').toString('utf-8');
  const expected = crypto
    .createHmac('sha256', Buffer.from(pluginKeyHex, 'hex'))
    .update(payloadStr)
    .digest();
  const got = Buffer.from(sigHex, 'hex');
  if (got.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(got, expected)) return null;

  let payload: { userId: string | number; username: string; iat?: unknown };
  try {
    payload = JSON.parse(payloadStr);
  } catch {
    return null;
  }
  if (typeof payload.iat === 'number') {
    if (nowSeconds - payload.iat > 60) return null;
    if (payload.iat - nowSeconds > 5) return null;
  }
  return { userId: payload.userId, username: payload.username };
}

test('derivePluginIdentityKey is deterministic and plugin-scoped', () => {
  const first = derivePluginIdentityKey(HOST_SECRET, 'account');
  const again = derivePluginIdentityKey(HOST_SECRET, 'account');
  const other = derivePluginIdentityKey(HOST_SECRET, 'terminal');

  assert.equal(first.length, 32);
  assert.ok(first.equals(again));
  assert.ok(!first.equals(other));
  assert.ok(!derivePluginIdentityKey('another-secret', 'account').equals(first));
});

test('derived key neither equals nor contains the host secret', () => {
  const keyHex = derivePluginIdentityKey(HOST_SECRET, 'account').toString('hex');
  const secretHex = Buffer.from(HOST_SECRET, 'utf8').toString('hex');
  assert.notEqual(keyHex, secretHex);
  assert.ok(!keyHex.includes(secretHex));
  assert.ok(!keyHex.includes(HOST_SECRET));
});

test('signed headers verify with the plugin-side helper and expose the user', () => {
  const key = derivePluginIdentityKey(HOST_SECRET, 'account');
  const nowMs = Date.now();
  const headers = signPluginUserIdentity({ id: 3, username: 'triage' }, key, nowMs);

  assert.equal(headers['x-plugin-user-algorithm'], 'sha256');
  assert.match(headers['x-plugin-user-signature'], /^sha256=[0-9a-f]{64}$/);
  assert.deepEqual(
    JSON.parse(Buffer.from(headers['x-plugin-user-payload'], 'base64').toString('utf8')),
    { userId: 3, username: 'triage', iat: Math.floor(nowMs / 1000) },
  );
  assert.deepEqual(verifyPluginIdentity(headers, key.toString('hex')), { userId: 3, username: 'triage' });
});

test('userId is canonical and id is only the fallback alias', () => {
  const key = derivePluginIdentityKey(HOST_SECRET, 'account');
  const headers = signPluginUserIdentity({ id: 'alias', userId: 42, username: 'ws-user' }, key);
  assert.deepEqual(verifyPluginIdentity(headers, key.toString('hex')), { userId: 42, username: 'ws-user' });
});

test('no headers are produced without a usable user id', () => {
  const key = derivePluginIdentityKey(HOST_SECRET, 'account');
  assert.deepEqual(signPluginUserIdentity(undefined, key), {});
  assert.deepEqual(signPluginUserIdentity({ username: 'nobody' }, key), {});
  assert.deepEqual(signPluginUserIdentity({ id: '' }, key), {});
});

test('a signature for one plugin does not verify for another', () => {
  const sign = createPluginIdentitySigner(HOST_SECRET);
  const headers = sign('account', { id: 3, username: 'triage' });
  assert.ok(verifyPluginIdentity(headers, derivePluginIdentityKey(HOST_SECRET, 'account').toString('hex')));
  assert.equal(verifyPluginIdentity(headers, derivePluginIdentityKey(HOST_SECRET, 'terminal').toString('hex')), null);
});

test('tampering with payload, signature or algorithm fails verification', () => {
  const key = derivePluginIdentityKey(HOST_SECRET, 'account');
  const keyHex = key.toString('hex');
  const headers = signPluginUserIdentity({ id: 3, username: 'triage' }, key);

  const forgedPayload = Buffer.from(JSON.stringify({ userId: 1, username: 'admin', iat: Math.floor(Date.now() / 1000) })).toString('base64');
  assert.equal(verifyPluginIdentity({ ...headers, 'x-plugin-user-payload': forgedPayload }, keyHex), null);

  const signature = headers['x-plugin-user-signature'];
  const flipped = signature.endsWith('0') ? `${signature.slice(0, -1)}1` : `${signature.slice(0, -1)}0`;
  assert.equal(verifyPluginIdentity({ ...headers, 'x-plugin-user-signature': flipped }, keyHex), null);
  assert.equal(verifyPluginIdentity({ ...headers, 'x-plugin-user-signature': 'sha256=abcd' }, keyHex), null);
  assert.equal(verifyPluginIdentity({ ...headers, 'x-plugin-user-signature': `md5=${signature.slice(7)}` }, keyHex), null);

  assert.equal(verifyPluginIdentity({ ...headers, 'x-plugin-user-algorithm': 'sha512' }, keyHex), null);
});

test('each missing header fails verification on its own', () => {
  const key = derivePluginIdentityKey(HOST_SECRET, 'account');
  const keyHex = key.toString('hex');
  const headers = signPluginUserIdentity({ id: 3, username: 'triage' }, key);

  for (const name of Object.keys(headers)) {
    const partial = { ...headers, [name]: undefined };
    assert.equal(verifyPluginIdentity(partial, keyHex), null, `${name} missing should fail`);
  }
});

test('replay window rejects stale and far-future payloads', () => {
  const key = derivePluginIdentityKey(HOST_SECRET, 'account');
  const keyHex = key.toString('hex');
  const now = 1_800_000_000;

  const fresh = signPluginUserIdentity({ id: 3, username: 'triage' }, key, (now - 30) * 1000);
  assert.deepEqual(verifyPluginIdentity(fresh, keyHex, now), { userId: 3, username: 'triage' });

  const stale = signPluginUserIdentity({ id: 3, username: 'triage' }, key, (now - 120) * 1000);
  assert.equal(verifyPluginIdentity(stale, keyHex, now), null);

  const future = signPluginUserIdentity({ id: 3, username: 'triage' }, key, (now + 30) * 1000);
  assert.equal(verifyPluginIdentity(future, keyHex, now), null);
});
