import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import '@/modules/i18n';
import { AuthProvider } from '@/modules/auth/context/AuthContext';
import LoginForm from '@/modules/auth/LoginForm';
import SetupForm from '@/modules/auth/SetupForm';

type StubbedReply = { status: number; body: unknown };

// The login and register routes hand every failure to the global error
// middleware, which answers with the structured AppError envelope; the auth
// middleware still answers with a bare `{ error: 'message' }`.
const envelope = (code: string, message: string) => ({ success: false, error: { code, message } });

// `api.auth.*` calls the global fetch directly, so stubbing it drives the
// real AuthProvider without any module mocks.
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
