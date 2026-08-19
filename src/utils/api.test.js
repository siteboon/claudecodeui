import assert from 'node:assert/strict';
import test from 'node:test';

import { isAuthTokenExpired, storeAuthToken, TOKEN_EXPIRY_SKEW_MS } from './api.js';

// Builds a JWT-shaped string (header.payload.signature, base64url segments) without
// needing a real signing library — isAuthTokenExpired() never verifies the signature,
// it only decodes the payload, so the header/signature segments are placeholders.
const makeToken = (payload) => {
  const encode = (value) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}.signature`;
};

test('isAuthTokenExpired: a token well before its exp is not expired', () => {
  const now = Math.floor(Date.now() / 1000);
  const token = makeToken({ iat: now - 60, exp: now + 600 }); // 10 min from now
  assert.equal(isAuthTokenExpired(token), false);
});

test('isAuthTokenExpired: a token expired within the clock-skew tolerance is not treated as expired', () => {
  const now = Math.floor(Date.now() / 1000);
  const skewSeconds = TOKEN_EXPIRY_SKEW_MS / 1000;
  const token = makeToken({ iat: now - 600, exp: now - Math.floor(skewSeconds / 2) });
  assert.equal(isAuthTokenExpired(token), false);
});

test('isAuthTokenExpired: a token expired just past the clock-skew tolerance is expired', () => {
  const now = Math.floor(Date.now() / 1000);
  const skewSeconds = TOKEN_EXPIRY_SKEW_MS / 1000;
  const token = makeToken({ iat: now - 600, exp: now - skewSeconds - 5 });
  assert.equal(isAuthTokenExpired(token), true);
});

test('isAuthTokenExpired: a token expired well past the skew tolerance is expired', () => {
  const now = Math.floor(Date.now() / 1000);
  const token = makeToken({ iat: now - 600, exp: now - 600 }); // 10 min ago
  assert.equal(isAuthTokenExpired(token), true);
});

test('isAuthTokenExpired: a malformed/unreadable token is unaffected by the skew change', () => {
  // readTokenClaims() returns null for these, so isAuthTokenExpired() short-circuits
  // to false regardless of TOKEN_EXPIRY_SKEW_MS — behaviour unchanged by this fix.
  assert.equal(isAuthTokenExpired('not-a-jwt'), false);
  assert.equal(isAuthTokenExpired('only.two-segments'), false);
  assert.equal(isAuthTokenExpired(null), false);
});

// storeAuthToken() reads and writes localStorage, which Node does not provide.
// `window` is deliberately left undefined so the success path skips its event
// dispatch and these tests assert storage effects only.
const useFakeStorage = (initial = null) => {
  let value = initial;
  globalThis.localStorage = {
    getItem: (key) => (key === 'auth-token' ? value : null),
    setItem: (key, next) => {
      if (key === 'auth-token') value = next;
    },
    removeItem: (key) => {
      if (key === 'auth-token') value = null;
    },
  };
  return () => value;
};

const secondsFromNow = (seconds) => Math.floor(Date.now() / 1000) + seconds;

test('storeAuthToken: rejects an already-expired token and keeps the stored one', () => {
  // The exact replay hazard: a cached 304 hands back an X-Refreshed-Token that
  // was minted days ago, which must never displace a live session.
  const live = makeToken({ iat: secondsFromNow(-60), exp: secondsFromNow(600) });
  const read = useFakeStorage(live);
  const stale = makeToken({ iat: secondsFromNow(-11 * 86400), exp: secondsFromNow(-4 * 86400) });

  assert.equal(storeAuthToken(stale), false);
  assert.equal(read(), live);
});

test('storeAuthToken: rejects a token older than the one already stored', () => {
  const current = makeToken({ iat: secondsFromNow(-60), exp: secondsFromNow(600) });
  const read = useFakeStorage(current);
  const older = makeToken({ iat: secondsFromNow(-3600), exp: secondsFromNow(300) });

  assert.equal(storeAuthToken(older), false);
  assert.equal(read(), current);
});

test('storeAuthToken: accepts a newer token, so the sliding refresh still works', () => {
  const current = makeToken({ iat: secondsFromNow(-3600), exp: secondsFromNow(300) });
  const read = useFakeStorage(current);
  const refreshed = makeToken({ iat: secondsFromNow(-1), exp: secondsFromNow(604800) });

  assert.equal(storeAuthToken(refreshed), true);
  assert.equal(read(), refreshed);
});

test('storeAuthToken: accepts a token when storage is empty, so login still works', () => {
  const read = useFakeStorage(null);
  const fresh = makeToken({ iat: secondsFromNow(-1), exp: secondsFromNow(604800) });

  assert.equal(storeAuthToken(fresh), true);
  assert.equal(read(), fresh);
});

test('storeAuthToken: still rejects values that are not JWT-shaped', () => {
  const live = makeToken({ iat: secondsFromNow(-60), exp: secondsFromNow(600) });
  const read = useFakeStorage(live);

  assert.equal(storeAuthToken('not-a-jwt'), false);
  assert.equal(storeAuthToken(null), false);
  assert.equal(read(), live);
});

test('storeAuthToken: rejects a JWT-shaped token with unreadable claims', () => {
  const live = makeToken({ iat: secondsFromNow(-60), exp: secondsFromNow(600) });
  const read = useFakeStorage(live);

  // Shape-valid but no iat/exp: previously stored, now refused because freshness
  // cannot be established.
  assert.equal(storeAuthToken(makeToken({ sub: 'no-claims' })), false);
  assert.equal(read(), live);
});
