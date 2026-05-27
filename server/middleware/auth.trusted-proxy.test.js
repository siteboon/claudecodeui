/**
 * Unit tests for trusted reverse-proxy header authentication helpers.
 *
 * Focus: the anti-spoofing boundary — a trusted identity header is only honoured when
 * the request's *direct* source IP (socket peer, never X-Forwarded-For) falls within
 * TRUSTED_PROXY_CIDRS, so a client reaching the app directly cannot forge an identity.
 *
 * Run: node --import tsx --test server/middleware/auth.trusted-proxy.test.js
 */
import assert from 'node:assert/strict';
import test from 'node:test';

// Pin a JWT secret + proxy config before import so loading the module is side-effect
// free (does not generate a secret via the database) and reads a known CIDR set.
process.env.JWT_SECRET = 'test-secret';
process.env.TRUSTED_PROXY_AUTH = 'true';
process.env.TRUSTED_PROXY_CIDRS = '127.0.0.0/8,::1/128,10.0.0.0/8';

const { cidrMatch, isFromTrustedProxy } = await import('./auth.js');

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
