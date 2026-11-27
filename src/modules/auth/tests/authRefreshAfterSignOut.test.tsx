import assert from 'node:assert/strict';

import { act, cleanup, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import { AuthProvider, useAuth } from '@/modules/auth/context/AuthContext';
import '@/modules/i18n';

/**
 * Past half of its lifetime, a token gets a replacement on every response:
 * in the X-Refreshed-Token header, and in the body of /api/auth/refresh. A
 * refresh still in flight when the user signed out used to write that
 * replacement back into storage, so the sign-in screen showed but the next
 * reload signed the user straight back in.
 */

const makeToken = (issuedAtSeconds: number) => {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const payload = { userId: 1, username: 'triage', iat: issuedAtSeconds, exp: issuedAtSeconds + 7 * 86400 };
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}.sig${issuedAtSeconds}`;
};

const nowSeconds = () => Math.floor(Date.now() / 1000);

let releaseRefresh: (() => void) | null = null;

const stubServer = () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/auth/refresh') {
      const replacement = makeToken(nowSeconds());
      await new Promise<void>((resolve) => {
        releaseRefresh = resolve;
      });
      return new Response(JSON.stringify({ token: replacement }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'X-Refreshed-Token': replacement },
      });
    }
    const body = url === '/api/auth/status'
      ? { needsSetup: false }
      : url === '/api/auth/user'
        ? { user: { id: 1, username: 'triage' } }
        : url === '/api/user/onboarding-status'
          ? { hasCompletedOnboarding: true }
          : {};
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }));
};

beforeEach(() => {
  localStorage.clear();
  releaseRefresh = null;
  stubServer();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// Value: protects=sign-out survives a refresh in flight; fails_when=refreshSession or authenticatedFetch store the replacement without checking the sending token; why_new=no test signs out mid-refresh; seam=none; no_claim=real network latency (delayed stub)
test('a refresh that completes after sign-out does not restore the session', async () => {
  // Four days into a seven-day token: the refresh point has passed, so the
  // provider asks for a replacement as soon as the user is known.
  localStorage.setItem('auth-token', makeToken(nowSeconds() - 4 * 86400));

  let logout: (() => void) | null = null;
  function Gate() {
    const auth = useAuth();
    useEffect(() => {
      logout = auth.logout;
    }, [auth.logout]);
    if (auth.isLoading) {
      return <div>loading</div>;
    }
    return <div>{auth.user ? 'workspace' : 'login'}</div>;
  }

  render(
    <AuthProvider>
      <Gate />
    </AuthProvider>,
  );
  await screen.findByText('workspace');
  await act(async () => {
    await vi.waitFor(() => assert.ok(releaseRefresh, 'the refresh request is in flight'));
  });

  await act(async () => {
    logout?.();
  });
  await act(async () => {
    releaseRefresh?.();
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

  assert.ok(screen.getByText('login'));
  assert.equal(localStorage.getItem('auth-token'), null);
});
