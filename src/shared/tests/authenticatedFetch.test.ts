import assert from 'node:assert/strict';

import { afterEach, beforeEach, test, vi } from 'vitest';

import { AUTH_SESSION_EXPIRED_EVENT, AUTH_TOKEN_REFRESHED_EVENT } from '@/shared/authToken';

/**
 * The consumer side of the JWT lifecycle that authToken.ts owns.
 * authToken.test.ts covers the primitives; nothing covered the request helper
 * that calls them on every API call in the app.
 *
 * IS_PLATFORM is resolved at module scope from a build-time flag and decides
 * whether the app authenticates with a bearer token at all, so each test loads
 * a fresh copy of api.ts with the flag stubbed. Reading the ambient value would
 * make these tests agree with whatever .env the machine happens to have — this
 * workspace has VITE_IS_PLATFORM=true, CI does not.
 */

const loadFetch = async (isPlatform: boolean) => {
  vi.stubEnv('VITE_IS_PLATFORM', isPlatform ? 'true' : 'false');
  vi.resetModules();
  return (await import('@/shared/api')).authenticatedFetch;
};

const makeToken = (payload: Record<string, unknown>) => {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}.signature`;
};

const liveToken = () => {
  const now = Math.floor(Date.now() / 1000);
  return makeToken({ iat: now, exp: now + 600 });
};

const expiredToken = () => {
  const now = Math.floor(Date.now() / 1000);
  return makeToken({ iat: now - 7200, exp: now - 3600 });
};

let lastInit: RequestInit | undefined;

const respondWith = (headers: Record<string, string> = {}) => {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    lastInit = init;
    return new Response('{}', { status: 200, headers });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

const sentHeaders = () => (lastInit?.headers ?? {}) as Record<string, string>;

beforeEach(() => {
  localStorage.clear();
  lastInit = undefined;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

test('a live token is sent as a bearer credential', async () => {
  const token = liveToken();
  localStorage.setItem('auth-token', token);
  respondWith();

  await (await loadFetch(false))('/api/projects');

  assert.equal(sentHeaders().Authorization, `Bearer ${token}`);
});

test('platform builds send no bearer token, because the session is a cookie', async () => {
  const token = liveToken();
  localStorage.setItem('auth-token', token);
  respondWith();

  await (await loadFetch(true))('/api/projects');

  assert.equal('Authorization' in sentHeaders(), false);
});

test('an expired token is never put on the wire', async () => {
  // getStoredAuthToken drops it rather than handing it over, so the request goes
  // out unauthenticated and the app is told the session is gone.
  localStorage.setItem('auth-token', expiredToken());
  let expiries = 0;
  const onExpired = () => {
    expiries += 1;
  };
  window.addEventListener(AUTH_SESSION_EXPIRED_EVENT, onExpired);
  respondWith();

  await (await loadFetch(false))('/api/projects');

  window.removeEventListener(AUTH_SESSION_EXPIRED_EVENT, onExpired);
  assert.equal('Authorization' in sentHeaders(), false);
  assert.equal(localStorage.getItem('auth-token'), null);
  assert.equal(expiries, 1);
});

test('no token means no Authorization header at all', async () => {
  respondWith();

  await (await loadFetch(false))('/api/projects');

  assert.equal('Authorization' in sentHeaders(), false);
});

test('authenticated responses always bypass the HTTP cache', async () => {
  respondWith();

  await (await loadFetch(false))('/api/projects', { cache: 'force-cache' });

  assert.equal(lastInit?.cache, 'no-store');
});

test('a JSON body is labelled as JSON', async () => {
  respondWith();

  await (await loadFetch(false))('/api/projects', { method: 'POST', body: '{"a":1}' });

  assert.equal(sentHeaders()['Content-Type'], 'application/json');
});

test('a FormData body is left for the browser to label', async () => {
  // Setting Content-Type by hand drops the multipart boundary and the upload
  // arrives unparseable.
  respondWith();

  await (await loadFetch(false))('/api/upload', { method: 'POST', body: new FormData() });

  assert.equal('Content-Type' in sentHeaders(), false);
});

test('a caller header wins over the default', async () => {
  respondWith();

  await (await loadFetch(false))('/api/projects', {
    method: 'POST',
    body: 'raw',
    headers: { 'Content-Type': 'text/plain' },
  });

  assert.equal(sentHeaders()['Content-Type'], 'text/plain');
});

test('a refreshed token on the response replaces the stored one', async () => {
  const now = Math.floor(Date.now() / 1000);
  localStorage.setItem('auth-token', makeToken({ iat: now - 60, exp: now + 540 }));
  const rotated = makeToken({ iat: now, exp: now + 600 });
  let announced: string | null = null;
  const onRefresh = (event: Event) => {
    announced = (event as CustomEvent<string>).detail;
  };
  window.addEventListener(AUTH_TOKEN_REFRESHED_EVENT, onRefresh);
  respondWith({ 'X-Refreshed-Token': rotated });

  await (await loadFetch(false))('/api/projects');

  window.removeEventListener(AUTH_TOKEN_REFRESHED_EVENT, onRefresh);
  assert.equal(localStorage.getItem('auth-token'), rotated);
  assert.equal(announced, rotated);
});

test('a slower older refresh response cannot replace a newer token', async () => {
  const now = Math.floor(Date.now() / 1000);
  const older = makeToken({ iat: now - 600, exp: now + 300 });
  const newer = makeToken({ iat: now - 60, exp: now + 600 });
  let releaseSlowResponse: (() => void) | undefined;
  const slowResponse = new Promise<void>((resolve) => {
    releaseSlowResponse = resolve;
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const isSlow = url.endsWith('/slow');
      if (isSlow) {
        await slowResponse;
      }
      return new Response('{}', {
        headers: { 'X-Refreshed-Token': isSlow ? older : newer },
      });
    }),
  );
  const fetch = await loadFetch(false);

  const slowRequest = fetch('/api/slow');
  await fetch('/api/fast');
  assert.ok(releaseSlowResponse);
  releaseSlowResponse();
  await slowRequest;

  assert.equal(localStorage.getItem('auth-token'), newer);
});

test('an auth error on the response ends the session', async () => {
  localStorage.setItem('auth-token', liveToken());
  let expiries = 0;
  const onExpired = () => {
    expiries += 1;
  };
  window.addEventListener(AUTH_SESSION_EXPIRED_EVENT, onExpired);
  respondWith({ 'X-Auth-Error': 'invalid' });

  await (await loadFetch(false))('/api/projects');

  window.removeEventListener(AUTH_SESSION_EXPIRED_EVENT, onExpired);
  assert.equal(expiries, 1);
  assert.equal(localStorage.getItem('auth-token'), null);
});

test('an ordinary response leaves the stored token alone', async () => {
  const token = liveToken();
  localStorage.setItem('auth-token', token);
  respondWith();

  await (await loadFetch(false))('/api/projects');

  assert.equal(localStorage.getItem('auth-token'), token);
});
