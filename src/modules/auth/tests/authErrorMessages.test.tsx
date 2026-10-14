import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import '@/modules/i18n';
import { AuthProvider } from '@/modules/auth/context/AuthContext';
import LoginForm from '@/modules/auth/LoginForm';
import SetupForm from '@/modules/auth/SetupForm';

type StubbedReply = { status: number; body: unknown };

/**
 * Builds the structured AppError envelope returned by login and registration
 * failures. Auth middleware can still return a bare `{ error: 'message' }`.
 */
const envelope = (code: string, message: string) => ({ success: false, error: { code, message } });

// `api.auth.*` calls the global fetch directly, so stubbing it drives the
// real AuthProvider without any module mocks.
/**
 * Stubs auth API responses by URL while retaining the real auth context.
 * Reads the supplied map on each request so tests can change a response before retrying.
 */
function stubAuthApi(replies: Record<string, StubbedReply>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const reply = replies[url] ?? { status: 404, body: { error: 'Not found' } };
      return new Response(
        typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body),
        { status: reply.status, headers: { 'Content-Type': 'application/json' } },
      );
    }),
  );
}

/** Renders the login form and submits the supplied credentials through the real auth context. */
async function submitLogin(username: string, password: string) {
  render(
    <AuthProvider>
      <LoginForm />
    </AuthProvider>,
  );
  fireEvent.change(await screen.findByLabelText('Username'), { target: { value: username } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));
}

/** Renders the setup form and submits matching passwords through the real auth context. */
async function submitSetup(username: string, password: string) {
  render(
    <AuthProvider>
      <SetupForm />
    </AuthProvider>,
  );
  fireEvent.change(await screen.findByLabelText('Username'), { target: { value: username } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } });
  fireEvent.change(screen.getByLabelText('Confirm Password'), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));
}

describe('auth screens surface server errors as text', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the message of the structured envelope when the password is wrong, and keeps the form', async () => {
    stubAuthApi({
      '/api/auth/status': { status: 200, body: { needsSetup: false, isAuthenticated: false } },
      '/api/auth/login': {
        status: 401,
        body: envelope('AUTH_INVALID_CREDENTIALS', 'Invalid username or password'),
      },
    });

    await submitLogin('triage', 'wrong-password');

    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Invalid username or password');
    expect(document.querySelectorAll('form')).toHaveLength(1);
  });

  it('lets a rejected login be corrected and retried successfully without remounting the form', async () => {
    const user = { id: 1, username: 'triage' };
    const now = Math.floor(Date.now() / 1000);
    const token = `${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify({ iat: now, exp: now + 3600 })).toString('base64url')}.test`;
    const replies: Record<string, StubbedReply> = {
      '/api/auth/status': { status: 200, body: { needsSetup: false, isAuthenticated: false } },
      '/api/auth/login': {
        status: 401,
        body: envelope('AUTH_INVALID_CREDENTIALS', 'Invalid username or password'),
      },
      '/api/auth/user': { status: 200, body: { user } },
      '/api/user/onboarding-status': { status: 200, body: { hasCompletedOnboarding: true } },
      '/api/user/preferences': { status: 200, body: { preferences: {} } },
      '/api/user/drafts': { status: 200, body: { drafts: {} } },
    };
    stubAuthApi(replies);

    await submitLogin('triage', 'wrong-password');
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Invalid username or password');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sign In' })).toHaveProperty('disabled', false));
    expect(localStorage.getItem('auth-token')).toBeNull();
    const form = document.querySelector('form');

    replies['/api/auth/login'] = { status: 200, body: { user, token } };
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'corrected-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

    await waitFor(() => {
      expect(localStorage.getItem('auth-token')).toBe(token);
      expect(screen.queryByRole('alert')).toBeNull();
      expect(screen.getByRole('button', { name: 'Sign In' })).toHaveProperty('disabled', false);
    });
    expect(document.querySelector('form')).toBe(form);
    const loginRequests = vi.mocked(fetch).mock.calls.filter(([url]) => url === '/api/auth/login');
    expect(loginRequests).toHaveLength(2);
    expect(loginRequests[1]?.[1]?.body).toBe(JSON.stringify({ username: 'triage', password: 'corrected-password' }));
  });

  it('shows the message of the structured envelope when registration is rejected', async () => {
    stubAuthApi({
      '/api/auth/status': { status: 200, body: { needsSetup: true, isAuthenticated: false } },
      '/api/auth/register': {
        status: 403,
        body: envelope('AUTH_USER_ALREADY_CONFIGURED', 'User already exists. This is a single-user system.'),
      },
    });

    await submitSetup('triage', 'triage-pass-123');

    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'User already exists. This is a single-user system.',
    );
    expect(document.querySelectorAll('form')).toHaveLength(1);
  });

  it('still shows the bare string error the auth middleware sends', async () => {
    stubAuthApi({
      '/api/auth/status': { status: 200, body: { needsSetup: false, isAuthenticated: false } },
      '/api/auth/login': { status: 401, body: { error: 'Invalid API key' } },
    });

    await submitLogin('triage', 'triage-pass-123');

    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Invalid API key');
  });

  it('falls back to the localized message when the envelope carries no usable message', async () => {
    stubAuthApi({
      '/api/auth/status': { status: 200, body: { needsSetup: false, isAuthenticated: false } },
      '/api/auth/login': { status: 500, body: { success: false, error: { code: 'INTERNAL_ERROR', message: '  ' } } },
    });

    await submitLogin('triage', 'triage-pass-123');

    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Login failed');
  });

  it('falls back to the localized message when the body is not JSON', async () => {
    stubAuthApi({
      '/api/auth/status': { status: 200, body: { needsSetup: false, isAuthenticated: false } },
      '/api/auth/login': { status: 502, body: '<html>Bad Gateway</html>' },
    });

    await submitLogin('triage', 'triage-pass-123');

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe('Login failed');
    });
  });
});
