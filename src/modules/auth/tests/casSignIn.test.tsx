import assert from 'node:assert/strict';

import { act, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import { AuthProvider, useAuth } from '@/modules/auth/context/AuthContext';
import LoginForm from '@/modules/auth/LoginForm';
import SetupForm from '@/modules/auth/SetupForm';
import { i18n } from '@/modules/i18n';
import { AUTH_SESSION_EXPIRED_EVENT } from '@/shared/authToken';

/**
 * Issue #805: CAS single sign-on. The server's CAS callback sends the browser
 * back to the SPA with `#cas_code=<one-time code>` (or `#cas_error=<reason>`);
 * the SPA must exchange that code exactly once, drop it from the address bar,
 * and sign in exactly like a password login. The login screens offer the CAS
 * button only when /api/auth/status says CAS is enabled.
 */

const SESSION_TOKEN = 'header.payload.signature';

type CasStatus = { enabled: boolean; loginLabel?: string | null };

let requests: Array<{ url: string; body: unknown }> = [];
let casStatus: CasStatus = { enabled: false };
let needsSetup = false;
let exchangeStatus = 200;

const stubServer = () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    requests.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });

    if (url === '/api/auth/status') {
      return json(200, { needsSetup, isAuthenticated: false, cas: casStatus });
    }
    if (url === '/api/auth/cas/exchange') {
      return exchangeStatus === 200
        ? json(200, { success: true, user: { id: 1, username: 'triage' }, token: SESSION_TOKEN })
        : json(exchangeStatus, { success: false, error: { code: 'AUTH_CAS_CODE_INVALID', message: 'expired' } });
    }
    if (url === '/api/user/onboarding-status') {
      return json(200, { hasCompletedOnboarding: true });
    }
    return json(404, {});
  }));
};

function Screen() {
  const { isLoading, user, needsSetup: setupRequired } = useAuth();
  if (isLoading) {
    return <div>loading</div>;
  }
  if (user) {
    return <div>signed in as {user.username}</div>;
  }
  return setupRequired ? <SetupForm /> : <LoginForm />;
}

const renderApp = () => render(
  <StrictMode>
    <AuthProvider>
      <Screen />
    </AuthProvider>
  </StrictMode>,
);

beforeEach(async () => {
  await i18n.changeLanguage('en');
  localStorage.clear();
  requests = [];
  casStatus = { enabled: false };
  needsSetup = false;
  exchangeStatus = 200;
  window.history.replaceState(null, '', '/');
  stubServer();
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

test('a CAS one-time code in the fragment is exchanged once and signs the user in', async () => {
  casStatus = { enabled: true, loginLabel: null };
  window.history.replaceState(null, '', '/session/abc?tab=files#cas_code=one-time-code');

  renderApp();
  await screen.findByText('signed in as triage');

  const exchanges = requests.filter((request) => request.url === '/api/auth/cas/exchange');
  // StrictMode runs the startup check twice; the single-use code is sent once.
  assert.deepEqual(exchanges, [{ url: '/api/auth/cas/exchange', body: { code: 'one-time-code' } }]);
  assert.equal(localStorage.getItem('auth-token'), SESSION_TOKEN);
  // The code is gone from the address bar; the deep link is kept.
  assert.equal(`${window.location.pathname}${window.location.search}${window.location.hash}`, '/session/abc?tab=files');
});

test('a CAS error in the fragment is shown on the login page and survives session-expired notices', async () => {
  casStatus = { enabled: true, loginLabel: null };
  window.history.replaceState(null, '', '/#cas_error=user_not_allowed');

  renderApp();
  const alert = await screen.findByRole('alert');
  assert.equal(alert.textContent, 'Your CAS account is not allowed to sign in to this CloudCLI instance.');
  assert.equal(window.location.hash, '');
  assert.equal(requests.some((request) => request.url === '/api/auth/cas/exchange'), false);

  // Signed-out pages fire this when a background request gets a 401.
  await act(async () => {
    window.dispatchEvent(new Event(AUTH_SESSION_EXPIRED_EVENT));
  });
  assert.equal(
    screen.getByRole('alert').textContent,
    'Your CAS account is not allowed to sign in to this CloudCLI instance.',
  );
});

test('an expired or reused code asks the user to sign in again', async () => {
  casStatus = { enabled: true, loginLabel: null };
  exchangeStatus = 401;
  window.history.replaceState(null, '', '/#cas_code=stale-code');

  renderApp();
  const alert = await screen.findByRole('alert');
  assert.equal(alert.textContent, 'Your CAS sign-in expired before it could be completed. Please try again.');
  assert.equal(localStorage.getItem('auth-token'), null);
  assert.equal(window.location.hash, '');
});

test('an unknown CAS error reason falls back to a generic message', async () => {
  casStatus = { enabled: true, loginLabel: null };
  window.history.replaceState(null, '', '/#cas_error=%3Cscript%3E');

  renderApp();
  const alert = await screen.findByRole('alert');
  assert.equal(alert.textContent, 'CAS sign-in failed. Please try again.');
});

test('the login page links to CAS sign-in with the current path only when CAS is enabled', async () => {
  window.history.replaceState(null, '', '/session/abc?tab=files');
  const { unmount } = renderApp();
  await screen.findByRole('button', { name: 'Sign In' });
  assert.equal(screen.queryByRole('link', { name: /CAS/ }), null);
  assert.equal(screen.queryByText('or'), null);
  unmount();

  casStatus = { enabled: true, loginLabel: null };
  const second = renderApp();
  const link = await screen.findByRole('link', { name: 'Sign in with CAS' });
  assert.equal(link.getAttribute('href'), '/api/auth/cas/login?returnTo=%2Fsession%2Fabc%3Ftab%3Dfiles');
  second.unmount();

  casStatus = { enabled: true, loginLabel: 'University SSO' };
  renderApp();
  await screen.findByRole('link', { name: 'University SSO' });
});

test('the setup page offers CAS sign-in, since the first allowlisted CAS sign-in creates the account', async () => {
  needsSetup = true;
  casStatus = { enabled: true, loginLabel: null };
  window.history.replaceState(null, '', '/#cas_error=ticket_rejected');

  renderApp();
  await screen.findByRole('button', { name: 'Create Account' });
  assert.ok(screen.getByRole('link', { name: 'Sign in with CAS' }));
  await waitFor(() => assert.equal(
    screen.getByRole('alert').textContent,
    'The CAS server did not confirm your sign-in. Please try again.',
  ));
});
