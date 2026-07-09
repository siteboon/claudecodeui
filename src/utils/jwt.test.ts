import assert from 'node:assert/strict';
import test from 'node:test';

import { isTokenExpired, TOKEN_EXPIRY_SKEW_MS } from './jwt';

// Builds a JWT-shaped string (header.payload.signature, base64url segments) without
// needing a real signing library — isTokenExpired() never verifies the signature,
// it only decodes the payload, so the header/signature segments are placeholders.
const makeToken = (payload: unknown) => {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}.signature`;
};

test('isTokenExpired: a token with a future exp is not expired', () => {
  const token = makeToken({ exp: Math.floor(Date.now() / 1000) + 600 }); // 10 min from now
  assert.equal(isTokenExpired(token), false);
});

test('isTokenExpired: a token expired well past the skew tolerance is expired', () => {
  const token = makeToken({ exp: Math.floor(Date.now() / 1000) - 600 }); // 10 min ago
  assert.equal(isTokenExpired(token), true);
});

test('isTokenExpired: a token expired within the clock-skew tolerance is not treated as expired', () => {
  const skewSeconds = TOKEN_EXPIRY_SKEW_MS / 1000;
  const token = makeToken({ exp: Math.floor(Date.now() / 1000) - Math.floor(skewSeconds / 2) });
  assert.equal(isTokenExpired(token), false);
});

test('isTokenExpired: a token expired just past the clock-skew tolerance is expired', () => {
  const skewSeconds = TOKEN_EXPIRY_SKEW_MS / 1000;
  const token = makeToken({ exp: Math.floor(Date.now() / 1000) - skewSeconds - 5 });
  assert.equal(isTokenExpired(token), true);
});

test('isTokenExpired: a token missing the exp claim is treated as expired', () => {
  const token = makeToken({ userId: 1, username: 'someone' });
  assert.equal(isTokenExpired(token), true);
});

test('isTokenExpired: a malformed token (unreadable payload) is treated as expired', () => {
  assert.equal(isTokenExpired('not-a-jwt'), true);
  assert.equal(isTokenExpired('only.two-segments'), true);
  assert.equal(isTokenExpired('header.not-valid-base64url-json.sig'), true);
});

test('isTokenExpired: a null token is treated as expired', () => {
  assert.equal(isTokenExpired(null), true);
});
