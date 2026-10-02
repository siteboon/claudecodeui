import assert from 'node:assert/strict';

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import '@/modules/i18n';
import { AuthProvider, useAuth } from '@/modules/auth/context/AuthContext';

/**
 * The startup auth check must only discard the stored token when the server
 * rejects it. A 5xx from `/api/auth/user` (the Vite dev proxy while the backend
 * restarts, or a reverse proxy in front of a restarting server) says nothing
 * about the token, and clearing it signed the user out for good.
 */

const STORED_TOKEN = 'stored-token';

let userStatus = 200;

const stubServer = () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const reply = url === '/api/auth/status'
      ? { status: 200, body: { needsSetup: false } }
      : url === '/api/auth/user'
        ? userStatus === 200
          ? { status: 200, body: { user: { id: 1, username: 'triage' } } }
          : { status: userStatus, body: { error: 'unavailable' } }
        : url === '/api/user/onboarding-status'
          ? { status: 200, body: { hasCompletedOnboarding: true } }
          : { status: 200, body: {} };
    return new Response(JSON.stringify(reply.body), {
      status: reply.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }));
};

function Gate() {
  const { isLoading, user, error } = useAuth();
  if (isLoading) {
    return <div>loading</div>;
  }
  if (!user) {
    return <div>login{error ? `: ${error}` : ''}</div>;
  }
  return <div>workspace</div>;
}

const renderApp = () => render(
  <AuthProvider>
    <Gate />
  </AuthProvider>,
);

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('auth-token', STORED_TOKEN);
  userStatus = 200;
  stubServer();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test('a server error on the startup user check keeps the stored token', async () => {
  userStatus = 500;
  renderApp();

  await screen.findByText('login: Failed to check authentication status');
  assert.equal(localStorage.getItem('auth-token'), STORED_TOKEN);
});

test('the kept token signs the user back in once the server answers', async () => {
  userStatus = 502;
  const first = renderApp();
  await screen.findByText(/^login/);
  first.unmount();

  userStatus = 200;
  renderApp();
  await screen.findByText('workspace');
});

test('a rejected token is still cleared', async () => {
  userStatus = 401;
  renderApp();

  await screen.findByText(/^login/);
  await waitFor(() => assert.equal(localStorage.getItem('auth-token'), null));
});
