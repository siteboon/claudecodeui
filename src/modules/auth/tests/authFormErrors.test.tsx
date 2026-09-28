import assert from 'node:assert/strict';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, test, vi } from 'vitest';

import { AuthProvider } from '@/modules/auth/context/AuthContext';
import LoginForm from '@/modules/auth/LoginForm';
import SetupForm from '@/modules/auth/SetupForm';

const requests = vi.hoisted(() => ({
  login: vi.fn(),
  register: vi.fn(),
  status: vi.fn(),
  user: vi.fn(),
  onboardingStatus: vi.fn(),
}));

vi.mock('react-i18next', () => {
  const t = (key: string) => key;
  return { useTranslation: () => ({ t }) };
});
vi.mock('@/shared/utils', () => ({ IS_PLATFORM: false }));
vi.mock('@/shared/api', () => ({
  api: {
    auth: requests,
    user: { onboardingStatus: requests.onboardingStatus },
  },
}));
vi.mock('@/shared/chatDrafts', () => ({
  hydrateChatDrafts: vi.fn(),
  resetChatDrafts: vi.fn(),
}));
vi.mock('@/shared/userSettings', () => ({
  hydrateUserPreferences: vi.fn(),
  resetUserPreferences: vi.fn(),
}));

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  requests.status.mockResolvedValue(jsonResponse({ needsSetup: false }));
});

async function submitForm(mode: 'login' | 'register' = 'login') {
  render(
    <AuthProvider>
      {mode === 'login' ? <LoginForm /> : <SetupForm />}
    </AuthProvider>,
  );
  fireEvent.change(screen.getByLabelText(`${mode}.username`), { target: { value: 'test-user' } });
  fireEvent.change(screen.getByLabelText(`${mode}.password`), { target: { value: 'test-password' } });
  if (mode === 'register') {
    fireEvent.change(screen.getByLabelText('register.confirmPassword'), { target: { value: 'test-password' } });
  }
  fireEvent.click(screen.getByRole('button', { name: `${mode}.submit` }));
  await waitFor(() => assert.ok(screen.getByRole('alert')));
}

test.each([
  {
    name: 'structured authentication errors',
    payload: { error: { code: 'AUTH_INVALID_CREDENTIALS', message: 'Invalid username or password' } },
    expected: 'Invalid username or password',
  },
  {
    name: 'legacy string errors',
    payload: { error: 'Legacy login error' },
    expected: 'Legacy login error',
  },
  {
    name: 'top-level messages',
    payload: { message: 'Please try again' },
    expected: 'Please try again',
  },
  {
    name: 'malformed nested messages with a valid top-level message',
    payload: { error: { code: 'ERROR', message: { unexpected: true } }, message: 'Readable fallback' },
    expected: 'Readable fallback',
  },
  {
    name: 'non-string error fields',
    payload: { error: { code: 'ERROR', message: { unexpected: true } }, message: ['unexpected'] },
    expected: 'errors.loginFailed',
  },
  {
    name: 'empty error messages',
    payload: { error: { code: 'ERROR', message: ' ' }, message: '' },
    expected: 'errors.loginFailed',
  },
])('login keeps the form usable for $name', async ({ payload, expected }) => {
  requests.login.mockResolvedValue(jsonResponse(payload, 401));
  await submitForm();
  await waitFor(() => assert.equal(screen.getByRole('alert').textContent, expected));
  assert.ok(screen.getByLabelText('login.username'));
  assert.equal((screen.getByRole('button', { name: 'login.submit' }) as HTMLButtonElement).disabled, false);
  assert.equal(localStorage.getItem('auth-token'), null);
});

test('registration shows a structured conflict error without crashing', async () => {
  requests.register.mockResolvedValue(jsonResponse({
    error: { code: 'AUTH_USER_ALREADY_CONFIGURED', message: 'User already exists' },
  }, 409));
  await submitForm('register');
  await waitFor(() => assert.equal(screen.getByRole('alert').textContent, 'User already exists'));
  assert.ok(screen.getByLabelText('register.username'));
});

test('login falls back to readable text for a non-JSON response', async () => {
  requests.login.mockResolvedValue(new Response('<h1>Unavailable</h1>', { status: 502 }));
  await submitForm();
  await waitFor(() => assert.equal(screen.getByRole('alert').textContent, 'errors.loginFailed'));
});

test('a rejected login can be corrected and retried successfully', async () => {
  requests.login.mockResolvedValueOnce(jsonResponse({
    error: { code: 'AUTH_INVALID_CREDENTIALS', message: 'Invalid username or password' },
  }, 401));
  await submitForm();
  await waitFor(() => assert.equal(screen.getByRole('alert').textContent, 'Invalid username or password'));

  const user = { id: 1, username: 'test-user' };
  const now = Math.floor(Date.now() / 1000);
  const token = `${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify({ iat: now, exp: now + 3600 })).toString('base64url')}.test`;
  requests.login.mockResolvedValueOnce(jsonResponse({ user, token }));
  requests.user.mockImplementation(async () => jsonResponse({ user }));
  requests.status.mockImplementation(async () => jsonResponse({ needsSetup: false }));
  requests.onboardingStatus.mockImplementation(async () => jsonResponse({ hasCompletedOnboarding: true }));
  fireEvent.change(screen.getByLabelText('login.password'), { target: { value: 'corrected-password' } });
  fireEvent.click(screen.getByRole('button', { name: 'login.submit' }));

  await waitFor(() => assert.equal(localStorage.getItem('auth-token'), token));
  assert.equal(screen.queryByRole('alert'), null);
  assert.deepEqual(requests.login.mock.calls[1], ['test-user', 'corrected-password']);
});
