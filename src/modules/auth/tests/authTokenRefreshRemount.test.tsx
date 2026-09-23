import assert from 'node:assert/strict';

import { act, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import { AuthProvider, useAuth } from '@/modules/auth/context/AuthContext';
import { i18n } from '@/modules/i18n';
import { storeAuthToken } from '@/shared/authToken';

/**
 * Issue #1269: once the stored JWT is past half of its lifetime, the server
 * attaches `X-Refreshed-Token` to every authenticated response. Each distinct
 * refreshed token used to re-run the whole auth bootstrap, which flips
 * `isLoading` back to true, so ProtectedRoute swapped the entire workspace for
 * the loading screen and remounted it — once per token, visible as the app
 * flashing. A token rotation must only swap the credential, and nothing after
 * mount (a language change included) may re-run that bootstrap.
 */

const makeToken = (issuedAtSeconds: number) => {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const payload = { userId: 1, username: 'triage', iat: issuedAtSeconds, exp: issuedAtSeconds + 7 * 86400 };
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}.sig${issuedAtSeconds}`;
};

const nowSeconds = () => Math.floor(Date.now() / 1000);

let requestedPaths: string[] = [];
let nextRefreshedToken: string | null = null;
let hasCompletedOnboarding = true;
let onboardingStatusDelayMs = 0;

const stubServer = () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    requestedPaths.push(url);
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (url === '/api/auth/user' && nextRefreshedToken) {
      headers['X-Refreshed-Token'] = nextRefreshedToken;
    }
    if (url === '/api/user/onboarding-status' && onboardingStatusDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, onboardingStatusDelayMs));
    }
    const body = url === '/api/auth/status'
      ? { needsSetup: false }
      : url === '/api/auth/user'
        ? { user: { id: 1, username: 'triage' } }
        : url === '/api/auth/login'
          ? { token: makeToken(nowSeconds()), user: { id: 1, username: 'triage' } }
          : url === '/api/user/onboarding-status'
            ? { hasCompletedOnboarding }
            : {};
    return new Response(JSON.stringify(body), { status: 200, headers });
  }));
};

// Mirrors ProtectedRoute's gate: the workspace only exists while auth is not
// loading, so every loading pass after sign-in is an unmount + remount.
let workspaceMounts = 0;
let loadingPasses = 0;
let seenToken: string | null = null;

function Workspace() {
  useEffect(() => {
    workspaceMounts += 1;
  }, []);
  return <div>workspace</div>;
}

function LoadingScreen() {
  useEffect(() => {
    loadingPasses += 1;
  }, []);
  return <div>loading</div>;
}

function Gate() {
  const { isLoading, user, token, hasCompletedOnboarding: onboarded } = useAuth();
  useEffect(() => {
    seenToken = token;
  }, [token]);
  if (isLoading) {
    return <LoadingScreen />;
  }
  if (!user) {
    return <div>login</div>;
  }
  return onboarded ? <Workspace /> : <div>onboarding</div>;
}

const renderApp = () => render(
  <AuthProvider>
    <Gate />
  </AuthProvider>,
);

beforeEach(() => {
  localStorage.clear();
  requestedPaths = [];
  nextRefreshedToken = null;
  hasCompletedOnboarding = true;
  onboardingStatusDelayMs = 0;
  workspaceMounts = 0;
  loadingPasses = 0;
  seenToken = null;
  stubServer();
});

afterEach(async () => {
  await i18n.changeLanguage('en');
  vi.unstubAllGlobals();
});

test('a refreshed token on the initial auth check does not run a second loading pass', async () => {
  const agedToken = makeToken(nowSeconds() - 4 * 86400);
  const refreshedToken = makeToken(nowSeconds());
  localStorage.setItem('auth-token', agedToken);
  nextRefreshedToken = refreshedToken;

  renderApp();
  await screen.findByText('workspace');
  // Let any effect queued by the token change settle.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

  assert.equal(localStorage.getItem('auth-token'), refreshedToken);
  assert.equal(seenToken, refreshedToken);
  assert.equal(requestedPaths.filter((path) => path === '/api/auth/user').length, 1);
  assert.equal(loadingPasses, 1);
  assert.equal(workspaceMounts, 1);
  assert.ok(screen.getByText('workspace'));
});

test('tokens refreshed while the workspace is open do not remount it', async () => {
  localStorage.setItem('auth-token', makeToken(nowSeconds() - 4 * 86400));

  renderApp();
  await screen.findByText('workspace');
  assert.equal(workspaceMounts, 1);
  const bootstrapRequests = requestedPaths.length;

  // In-flight requests that still carried the aged token each come back with
  // their own refreshed token (a new string every second on the server).
  const rotations = [makeToken(nowSeconds()), makeToken(nowSeconds() + 1), makeToken(nowSeconds() + 2)];
  for (const token of rotations) {
    await act(async () => {
      storeAuthToken(token);
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }

  await waitFor(() => assert.equal(seenToken, rotations[2]));
  assert.equal(workspaceMounts, 1);
  assert.equal(loadingPasses, 1);
  assert.deepEqual(
    requestedPaths.slice(bootstrapRequests).filter((path) => path.startsWith('/api/auth/')),
    [],
  );
});

test('signing out after a token rotation still shows the login screen without a loading pass', async () => {
  localStorage.setItem('auth-token', makeToken(nowSeconds()));

  let logout: (() => void) | null = null;
  function LogoutProbe() {
    const { logout: authLogout } = useAuth();
    useEffect(() => {
      logout = authLogout;
    }, [authLogout]);
    return null;
  }

  render(
    <AuthProvider>
      <LogoutProbe />
      <Gate />
    </AuthProvider>,
  );
  await screen.findByText('workspace');

  await act(async () => {
    storeAuthToken(makeToken(nowSeconds() + 1));
  });
  await act(async () => {
    logout?.();
  });

  await screen.findByText('login');
  assert.equal(localStorage.getItem('auth-token'), null);
  assert.equal(seenToken, null);
  assert.equal(loadingPasses, 1);
});

test('a language change after sign-in does not re-run the auth bootstrap', async () => {
  localStorage.setItem('auth-token', makeToken(nowSeconds()));

  renderApp();
  await screen.findByText('workspace');
  const bootstrapRequests = requestedPaths.length;

  // react-i18next hands out a new `t` on every language change. Sign-in also
  // changes the language by itself when the account's saved language differs
  // from this device's.
  await act(async () => {
    await i18n.changeLanguage('de');
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

  assert.equal(i18n.language, 'de');
  assert.equal(workspaceMounts, 1);
  assert.equal(loadingPasses, 1);
  assert.deepEqual(
    requestedPaths.slice(bootstrapRequests).filter((path) => path.startsWith('/api/auth/')),
    [],
  );
});

test('signing in before onboarding shows onboarding without mounting the workspace first', async () => {
  hasCompletedOnboarding = false;
  // Long enough for React to render whatever the context publishes before
  // the onboarding status arrives.
  onboardingStatusDelayMs = 30;

  let login: ((username: string, password: string) => Promise<unknown>) | null = null;
  function LoginProbe() {
    const { login: authLogin } = useAuth();
    useEffect(() => {
      login = authLogin;
    }, [authLogin]);
    return null;
  }

  render(
    <AuthProvider>
      <LoginProbe />
      <Gate />
    </AuthProvider>,
  );
  await screen.findByText('login');

  let pendingLogin: Promise<unknown> | undefined;
  act(() => {
    pendingLogin = login?.('triage', 'triage-pass-123');
  });
  await screen.findByText('onboarding');
  await act(async () => {
    await pendingLogin;
  });

  assert.ok(requestedPaths.includes('/api/user/onboarding-status'));
  assert.notEqual(localStorage.getItem('auth-token'), null);
  assert.equal(workspaceMounts, 0);
});
