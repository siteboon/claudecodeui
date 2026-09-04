import assert from 'node:assert/strict';
import test from 'node:test';

import { extractApiErrorMessage, extractResponseError, isAuthTokenExpired, TOKEN_EXPIRY_SKEW_MS } from './api.js';

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

test('extractApiErrorMessage: extracts strings and object formats correctly', () => {
  // Fallbacks
  assert.equal(extractApiErrorMessage(null), 'Operation failed');
  assert.equal(extractApiErrorMessage(undefined, 'Custom fallback'), 'Custom fallback');
  assert.equal(extractApiErrorMessage(''), 'Operation failed');

  // Direct string
  assert.equal(extractApiErrorMessage('Network timeout'), 'Network timeout');

  // Standard server structured error { error: { code, message } }
  assert.equal(
    extractApiErrorMessage({ error: { code: 'INTERNAL_ERROR', message: 'git clone failed' } }),
    'git clone failed',
  );

  // Server structured error with details { error: { code, details } }
  assert.equal(
    extractApiErrorMessage({ error: { code: 'INVALID_INPUT', details: 'Invalid plugin url' } }),
    'Invalid plugin url',
  );

  // Server structured error fallback to code
  assert.equal(
    extractApiErrorMessage({ error: { code: 'ERR_TIMEOUT' } }),
    'ERR_TIMEOUT',
  );

  // Error is direct string
  assert.equal(
    extractApiErrorMessage({ error: 'Direct error text' }),
    'Direct error text',
  );

  // Details field
  assert.equal(
    extractApiErrorMessage({ details: 'Details text' }),
    'Details text',
  );
  assert.equal(
    extractApiErrorMessage({ details: { message: 'Details obj message' } }),
    'Details obj message',
  );

  // Message field
  assert.equal(
    extractApiErrorMessage({ message: 'General message' }),
    'General message',
  );
});

test('extractResponseError: extracts from mock Response object', async () => {
  const jsonResponse = {
    status: 500,
    statusText: 'Internal Server Error',
    json: async () => ({ error: { code: 'INTERNAL_ERROR', message: 'Database connection failed' } }),
  };
  const message = await extractResponseError(jsonResponse, 'Server error');
  assert.equal(message, 'Database connection failed');

  const nonJsonResponse = {
    status: 502,
    statusText: 'Bad Gateway',
    json: async () => { throw new Error('Not JSON'); },
  };
  const fallbackMessage = await extractResponseError(nonJsonResponse, 'Proxy error');
  assert.equal(fallbackMessage, 'Bad Gateway');
});

