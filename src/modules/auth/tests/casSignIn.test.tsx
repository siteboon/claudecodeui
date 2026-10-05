import assert from 'node:assert/strict';

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
// When set, the matching response waits until the test resolves it.
let exchangeGate: Promise<void> | null = null;
let loginGate: Promise<void> | null = null;

const createGate = () => {
  let open = () => {};
  const gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { gate, open };
};

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
      await exchangeGate;
      return exchangeStatus === 200
        ? json(200, { success: true, user: { id: 1, username: 'triage' }, token: SESSION_TOKEN })
        : json(exchangeStatus, { success: false, error: { code: 'AUTH_CAS_CODE_INVALID', message: 'expired' } });
    }
    if (url === '/api/auth/login') {
      await loginGate;
      return json(200, { success: true, user: { id: 1, username: 'triage' }, token: SESSION_TOKEN });
    }
    if (url === '/api/user/onboarding-status') {
      return json(200, { hasCompletedOnboarding: true });
    }
    return json(404, {});
  }));
};

function Screen() {
  const { isLoading, user, needsSetup: setupRequired, logout } = useAuth();
  if (isLoading) {
    return <div>loading</div>;
  }
  if (user) {
    return (
      <>
        <div>signed in as {user.username}</div>
        <button type="button" onClick={logout}>log out</button>
      </>
    );
  }
  return setupRequired ? <SetupForm /> : <LoginForm />;
}

const signInWithPassword = async () => {
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'triage' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'triage-pass-123' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));
  await screen.findByText('signed in as triage');
};

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
  exchangeGate = null;
  loginGate = null;
  window.history.replaceState(null, '', '/');
  stubServer();
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

test('a CAS one-time code in the fragment is exchanged once and signs the user in', async () => {
  casStatus = { enabled: true, loginLabel: null };
  const exchange = createGate();
  exchangeGate = exchange.gate;
  window.history.replaceState(null, '', '/session/abc?tab=files#cas_code=one-time-code');

  renderApp();
  await waitFor(() => assert.ok(requests.some((request) => request.url === '/api/auth/cas/exchange')));
  // Give the second StrictMode run time to finish its own startup check: it
  // must wait for the same exchange instead of showing the login form.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  assert.equal(screen.queryByRole('button', { name: 'Sign In' }) === null, true, 'login form shown during exchange');
  assert.ok(screen.getByText('loading'));

  exchange.open();
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

test('a failed CAS attempt is forgotten once the user signs in another way', async () => {
  casStatus = { enabled: true, loginLabel: null };
  window.history.replaceState(null, '', '/#cas_error=user_not_allowed');

  renderApp();
  const alert = await screen.findByRole('alert');
  assert.equal(alert.textContent, 'Your CAS account is not allowed to sign in to this CloudCLI instance.');

  await signInWithPassword();
  fireEvent.click(screen.getByRole('button', { name: 'log out' }));
  await screen.findByRole('button', { name: 'Sign In' });
  assert.equal(screen.queryByRole('alert') === null, true, 'stale CAS error shown after logout');

  // A later expiry explains itself instead of repeating the old CAS error.
  await signInWithPassword();
  await act(async () => {
    window.dispatchEvent(new Event(AUTH_SESSION_EXPIRED_EVENT));
  });
  assert.equal((await screen.findByRole('alert')).textContent, 'Your session expired. Please log in again.');
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
  // Compared as booleans: handing a DOM node to node:assert makes a failure
  // try to serialize the whole node.
  assert.equal(screen.queryByRole('link', { name: /CAS/ }) === null, true, 'CAS link must be absent');
  assert.equal(screen.queryByText('or') === null, true, 'divider must be absent');
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

test('the CAS link is inert, also for the keyboard, while a password sign-in is in flight', async () => {
  casStatus = { enabled: true, loginLabel: null };
  const login = createGate();
  loginGate = login.gate;

  renderApp();
  const link = await screen.findByRole('link', { name: 'Sign in with CAS' });
  assert.equal(link.getAttribute('aria-disabled'), 'false');
  assert.equal(link.getAttribute('tabindex'), null);

  fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'triage' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'triage-pass-123' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));
  await waitFor(() => assert.equal(link.getAttribute('aria-disabled'), 'true'));
  assert.equal(link.getAttribute('tabindex'), '-1');
  // fireEvent returns false when the click's default action (navigation) was prevented.
  assert.equal(fireEvent.click(link), false);

  login.open();
  await screen.findByText('signed in as triage');
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
