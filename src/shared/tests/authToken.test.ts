import assert from 'node:assert/strict';

import { test } from 'vitest';

import {
  AUTH_SESSION_EXPIRED_EVENT,
  AUTH_TOKEN_REFRESHED_EVENT,
  getAuthTokenRefreshDelay,
  getStoredAuthToken,
  isAuthTokenExpired,
  storeAuthToken,
  TOKEN_EXPIRY_SKEW_MS,
} from '@/shared/authToken';

// Builds a JWT-shaped string (header.payload.signature, base64url segments) without
// needing a real signing library — isAuthTokenExpired() never verifies the signature,
// it only decodes the payload, so the header/signature segments are placeholders.
const makeToken = (payload: Record<string, unknown>) => {
  const encode = (value: unknown) =>
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

test('storeAuthToken: a valid token is persisted and announced to the app', () => {
  localStorage.clear();
  const now = Math.floor(Date.now() / 1000);
  const token = makeToken({ iat: now, exp: now + 600 });

  let announced: string | null = null;
  const onRefresh = (event: Event) => {
    announced = (event as CustomEvent<string>).detail;
  };
  window.addEventListener(AUTH_TOKEN_REFRESHED_EVENT, onRefresh);

  const stored = storeAuthToken(token);

  window.removeEventListener(AUTH_TOKEN_REFRESHED_EVENT, onRefresh);
  assert.equal(stored, true);
  assert.equal(localStorage.getItem('auth-token'), token);
  assert.equal(announced, token);
});

test('storeAuthToken: a non-token value is rejected and does not overwrite the session', () => {
  localStorage.clear();
  localStorage.setItem('auth-token', 'existing');

  assert.equal(storeAuthToken(undefined), false);
  assert.equal(storeAuthToken(''), false);
  assert.equal(storeAuthToken({ token: 'x' }), false);
  assert.equal(localStorage.getItem('auth-token'), 'existing');
});

// Counts AUTH_TOKEN_REFRESHED_EVENT dispatches while `run` executes.
const countRefreshEvents = (run: () => void): number => {
  let events = 0;
  const onRefresh = () => {
    events += 1;
  };
  window.addEventListener(AUTH_TOKEN_REFRESHED_EVENT, onRefresh);
  run();
  window.removeEventListener(AUTH_TOKEN_REFRESHED_EVENT, onRefresh);
  return events;
};

test('storeAuthToken: re-storing the identical token is a no-op', () => {
  localStorage.clear();
  const now = Math.floor(Date.now() / 1000);
  const token = makeToken({ userId: 1, username: 'a', iat: now, exp: now + 600 });
  localStorage.setItem('auth-token', token);

  const events = countRefreshEvents(() => {
    assert.equal(storeAuthToken(token), true);
  });

  assert.equal(events, 0);
  assert.equal(localStorage.getItem('auth-token'), token);
});

test('storeAuthToken: a same-user token that is not newer is ignored', () => {
  localStorage.clear();
  const now = Math.floor(Date.now() / 1000);
  const newer = makeToken({ userId: 1, username: 'a', iat: now, exp: now + 600 });
  const older = makeToken({ userId: 1, username: 'a', iat: now - 1, exp: now + 599 });
  const sameAge = makeToken({ userId: 1, username: 'a', iat: now, exp: now + 601 });
  localStorage.setItem('auth-token', newer);

  const events = countRefreshEvents(() => {
    assert.equal(storeAuthToken(older), true);
    assert.equal(storeAuthToken(sameAge), true);
  });

  assert.equal(events, 0);
  assert.equal(localStorage.getItem('auth-token'), newer);
});

test('storeAuthToken: a same-user strictly newer token applies', () => {
  localStorage.clear();
  const now = Math.floor(Date.now() / 1000);
  const older = makeToken({ userId: 1, username: 'a', iat: now - 60, exp: now + 540 });
  const newer = makeToken({ userId: 1, username: 'a', iat: now, exp: now + 600 });
  localStorage.setItem('auth-token', older);

  const events = countRefreshEvents(() => {
    assert.equal(storeAuthToken(newer), true);
  });

  assert.equal(events, 1);
  assert.equal(localStorage.getItem('auth-token'), newer);
});

test('storeAuthToken: a different user\'s token applies even when it is older', () => {
  localStorage.clear();
  const now = Math.floor(Date.now() / 1000);
  const current = makeToken({ userId: 1, username: 'a', iat: now, exp: now + 600 });
  const otherUser = makeToken({ userId: 2, username: 'b', iat: now - 60, exp: now + 540 });
  localStorage.setItem('auth-token', current);

  const events = countRefreshEvents(() => {
    assert.equal(storeAuthToken(otherUser), true);
  });

  assert.equal(events, 1);
  assert.equal(localStorage.getItem('auth-token'), otherUser);
});

test('storeAuthToken: tokens without user claims still apply (no subject to compare)', () => {
  localStorage.clear();
  const now = Math.floor(Date.now() / 1000);
  const current = makeToken({ userId: 1, username: 'a', iat: now, exp: now + 600 });
  const noSubject = makeToken({ iat: now - 60, exp: now + 540 });
  localStorage.setItem('auth-token', current);

  const events = countRefreshEvents(() => {
    assert.equal(storeAuthToken(noSubject), true);
  });

  assert.equal(events, 1);
  assert.equal(localStorage.getItem('auth-token'), noSubject);
});

test('storeAuthToken: a null userId is no subject — such tokens always apply', () => {
  localStorage.clear();
  const now = Math.floor(Date.now() / 1000);
  const current = makeToken({ userId: null, username: 'guest', iat: now, exp: now + 600 });
  const older = makeToken({ userId: null, username: 'guest', iat: now - 60, exp: now + 540 });
  localStorage.setItem('auth-token', current);

  const events = countRefreshEvents(() => {
    assert.equal(storeAuthToken(older), true);
  });

  assert.equal(events, 1);
  assert.equal(localStorage.getItem('auth-token'), older);
});

test('getStoredAuthToken: an expired token is dropped and the expiry is announced once', () => {
  localStorage.clear();
  const now = Math.floor(Date.now() / 1000);
  localStorage.setItem('auth-token', makeToken({ iat: now - 7200, exp: now - 3600 }));

  let expiries = 0;
  const onExpired = () => {
    expiries += 1;
  };
  window.addEventListener(AUTH_SESSION_EXPIRED_EVENT, onExpired);

  const token = getStoredAuthToken();

  window.removeEventListener(AUTH_SESSION_EXPIRED_EVENT, onExpired);
  assert.equal(token, null, 'an expired token must not be handed to a request');
  assert.equal(localStorage.getItem('auth-token'), null);
  assert.equal(expiries, 1);
});

test('getStoredAuthToken: a live token is returned and left in storage', () => {
  localStorage.clear();
  const now = Math.floor(Date.now() / 1000);
  const token = makeToken({ iat: now, exp: now + 600 });
  localStorage.setItem('auth-token', token);

  assert.equal(getStoredAuthToken(), token);
  assert.equal(localStorage.getItem('auth-token'), token);
});

test('getAuthTokenRefreshDelay: refresh is scheduled at the halfway point of the lifetime', () => {
  const now = Math.floor(Date.now() / 1000);
  const token = makeToken({ iat: now, exp: now + 600 }); // halfway = +300s

  const delay = getAuthTokenRefreshDelay(token);
  assert.ok(delay !== null);
  assert.ok(Math.abs(delay - 300_000) < 2_000, `expected ~300000ms, got ${delay}`);
});

test('getAuthTokenRefreshDelay: an already-past refresh point schedules immediately, never negative', () => {
  const now = Math.floor(Date.now() / 1000);
  assert.equal(getAuthTokenRefreshDelay(makeToken({ iat: now - 600, exp: now - 300 })), 0);
});

test('getAuthTokenRefreshDelay: an unreadable token schedules nothing', () => {
  // null means "no refresh timer", which is distinct from 0 ("refresh now").
  assert.equal(getAuthTokenRefreshDelay('not-a-jwt'), null);
  assert.equal(getAuthTokenRefreshDelay(null), null);
});
