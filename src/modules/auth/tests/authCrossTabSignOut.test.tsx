import assert from 'node:assert/strict';

import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import '@/modules/i18n';

/**
 * Signing out in one tab used to leave every other open tab fully signed in
 * until it next hit a 401. The other tabs learn about it from the `storage`
 * event the token removal fires there, and sign out quietly — it is not an
 * expired session, so no "session expired" message.
 */

const makeToken = (issuedAtSeconds: number) => {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const payload = { userId: 1, username: 'triage', iat: issuedAtSeconds, exp: issuedAtSeconds + 7 * 86400 };
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}.sig${issuedAtSeconds}`;
};

const nowSeconds = () => Math.floor(Date.now() / 1000);

const stubServer = () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
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

// AuthContext reads IS_PLATFORM at module load, so each mode gets a fresh copy.
const renderApp = async (isPlatform: boolean) => {
  vi.stubEnv('VITE_IS_PLATFORM', isPlatform ? 'true' : 'false');
  vi.resetModules();
  const { AuthProvider, useAuth } = await import('@/modules/auth/context/AuthContext');

  function Gate() {
    const { isLoading, user, error } = useAuth();
    if (isLoading) {
      return <div>loading</div>;
    }
    if (!user) {
      return <div>{`login${error ? `: ${error}` : ''}`}</div>;
    }
    return <div>workspace</div>;
  }

  render(
    <AuthProvider>
      <Gate />
    </AuthProvider>,
  );
  await screen.findByText('workspace');
};

// What the browser delivers in this tab when another tab changes localStorage.
const otherTabChanges = async (key: string | null, newValue: string | null) => {
  await act(async () => {
    window.dispatchEvent(new StorageEvent('storage', { key, newValue, storageArea: localStorage }));
  });
};

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('auth-token', makeToken(nowSeconds()));
  stubServer();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

// Value: protects=sign-out reaches every open tab; fails_when=no storage listener, or it misreads the removal or clear-all event, or reports the session as expired; why_new=no cross-tab listener existed; seam=none; no_claim=real browser event delivery (StorageEvent dispatched by hand)
test('another tab signing out or clearing storage signs this tab out without an error', async () => {
  for (const [key, newValue] of [['auth-token', null], [null, null]] as const) {
    await renderApp(false);
    localStorage.removeItem('auth-token');

    await otherTabChanges(key, newValue);

    assert.ok(await screen.findByText('login'), `key=${String(key)} should sign out`);
    cleanup();
    localStorage.setItem('auth-token', makeToken(nowSeconds()));
  }
});

// Value: protects=a refresh in another tab keeps this tab signed in; fails_when=the listener reacts to every auth-token change; why_new=negative case of the new listener; seam=none; no_claim=none beyond protects
test('another tab storing a refreshed token keeps this tab signed in', async () => {
  await renderApp(false);
  const refreshedToken = makeToken(nowSeconds() + 1);
  localStorage.setItem('auth-token', refreshedToken);

  await otherTabChanges('auth-token', refreshedToken);

  assert.ok(screen.getByText('workspace'));
  assert.equal(localStorage.getItem('auth-token'), refreshedToken);
});

// Value: protects=platform mode keeps its built-in user; fails_when=the IS_PLATFORM guard on the listener is removed; why_new=platform user is never cleared elsewhere; seam=none; no_claim=real platform build
test('platform mode ignores another tab clearing storage', async () => {
  await renderApp(true);

  await otherTabChanges(null, null);

  assert.ok(screen.getByText('workspace'));
});
