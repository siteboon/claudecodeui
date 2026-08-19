import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';

import React from 'react';
import TestRenderer from 'react-test-renderer';

/**
 * Regression coverage for the auth re-entrancy loop.
 *
 * `authenticateToken()` attaches `X-Refreshed-Token` to *every* authenticated
 * response once the caller's token is past half-life, and `authenticatedFetch`
 * pipes that into `storeAuthToken()` -> `setToken()`. `checkAuthStatus` must not
 * be rebuilt when `token` changes: if it is, the mount effect that calls it
 * re-runs on every refresh and re-verifies the session, issuing three more
 * authenticated requests that can refresh the token again.
 *
 * The loop is invisible while the token only moves forward, because `iat` has
 * one-second resolution and `setToken` bails on an identical string. These tests
 * therefore drive the case where the token alternates between two values, which
 * is what an HTTP-cached `X-Refreshed-Token` produces in the field.
 */

const AUTH_TOKEN_KEY = 'auth-token';

const makeToken = (iatOffsetSeconds: number) => {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  const iat = Math.floor(Date.now() / 1000) + iatOffsetSeconds;
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
    userId: 1,
    username: 'tester',
    iat,
    exp: iat + 7 * 24 * 60 * 60,
  })}.signature`;
};

/** Two valid tokens with different `iat`, so each replaces the other in state. */
const TOKEN_A = makeToken(-6 * 24 * 60 * 60);
const TOKEN_B = makeToken(-5 * 24 * 60 * 60);

type Counts = Record<string, number>;

const originals: Record<string, unknown> = {};

const installEnvironment = () => {
  for (const key of ['localStorage', 'window', 'document', 'fetch']) {
    originals[key] = (globalThis as Record<string, unknown>)[key];
  }

  const store = new Map<string, string>([[AUTH_TOKEN_KEY, TOKEN_A]]);
  const localStorage = {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => store.set(key, String(value)),
    removeItem: (key: string) => store.delete(key),
  };
  (globalThis as Record<string, unknown>).localStorage = localStorage;

  const target = new EventTarget();
  (globalThis as Record<string, unknown>).window = {
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    dispatchEvent: target.dispatchEvent.bind(target),
    setTimeout: (fn: () => void, ms?: number) => setTimeout(fn, ms),
    clearTimeout: (handle: number) => clearTimeout(handle),
    localStorage,
  };

  const documentTarget = new EventTarget();
  (globalThis as Record<string, unknown>).document = {
    addEventListener: documentTarget.addEventListener.bind(documentTarget),
    removeEventListener: documentTarget.removeEventListener.bind(documentTarget),
    visibilityState: 'visible',
  };
};

const restoreEnvironment = () => {
  for (const [key, value] of Object.entries(originals)) {
    if (value === undefined) {
      delete (globalThis as Record<string, unknown>)[key];
    } else {
      (globalThis as Record<string, unknown>)[key] = value;
    }
  }
};

/**
 * The refreshed token is only offered this many times. A correct provider never
 * uses more than the first; a re-entrant one exhausts the budget and then
 * settles, so the assertion below fails with a count instead of hanging CI.
 */
const REFRESH_BUDGET = 10;

/**
 * Serves the three endpoints `checkAuthStatus` touches. `/api/auth/user`
 * alternates the refreshed token it hands back, standing in for a server that
 * keeps re-issuing while a cache replays an older value.
 */
const installFetch = (counts: Counts) => {
  let alternate = false;
  (globalThis as Record<string, unknown>).fetch = (input: unknown) => {
    const url = String(input);
    counts[url] = (counts[url] ?? 0) + 1;

    const json = (body: unknown, headers: Record<string, string> = {}) =>
      Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...headers },
        }),
      );

    if (url.startsWith('/api/auth/status')) {
      return json({ needsSetup: false, isAuthenticated: true });
    }
    if (url.startsWith('/api/auth/user')) {
      const body = { user: { id: 1, username: 'tester' } };
      if (counts[url] > REFRESH_BUDGET) {
        return json(body);
      }
      alternate = !alternate;
      return json(body, { 'X-Refreshed-Token': alternate ? TOKEN_B : TOKEN_A });
    }
    if (url.startsWith('/api/user/onboarding-status')) {
      return json({ hasCompletedOnboarding: true });
    }
    return json({});
  };
};

const mountProvider = async () => {
  const { AuthProvider } = await import('./AuthContext');
  await TestRenderer.act(async () => {
    TestRenderer.create(React.createElement(AuthProvider as never, null, null));
  });
  // Let any re-entrant verification run; a looping provider issues thousands of
  // requests in this window, a correct one issues none.
  await TestRenderer.act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 250));
  });
};

beforeEach(installEnvironment);
afterEach(restoreEnvironment);

test('verifies the session once per mount even while the token keeps being refreshed', async () => {
  const counts: Counts = {};
  installFetch(counts);

  await mountProvider();

  assert.equal(
    counts['/api/auth/user'],
    1,
    `expected exactly one session verification, got ${counts['/api/auth/user']} — ` +
      'checkAuthStatus is being rebuilt on every token change',
  );
  assert.equal(counts['/api/auth/status'], 1);
  assert.equal(counts['/api/user/onboarding-status'], 1);
});

test('a refreshed token does not re-trigger verification', async () => {
  const counts: Counts = {};
  installFetch(counts);

  await mountProvider();
  const afterMount = counts['/api/auth/user'];

  // A refresh arriving after mount (the `X-Refreshed-Token` path) updates the
  // stored session but must not restart verification.
  const { storeAuthToken } = await import('../../../utils/api.js');
  await TestRenderer.act(async () => {
    storeAuthToken(TOKEN_B);
    await new Promise((resolve) => setTimeout(resolve, 250));
  });

  assert.equal(counts['/api/auth/user'], afterMount);
});
