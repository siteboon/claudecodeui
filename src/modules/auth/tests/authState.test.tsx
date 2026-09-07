import assert from 'node:assert/strict';

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import {
  AuthProvider,
  classifyAuthProbe,
  rejectionEndsSession,
  useAuth,
} from '@/modules/auth/context/AuthContext';
import type { AuthViewState } from '@/modules/auth/ProtectedRoute';
import { resolveAuthView } from '@/modules/auth/ProtectedRoute';

const mocks = vi.hoisted(() => ({
  authStatus: vi.fn(),
  authUser: vi.fn(),
  onboardingStatus: vi.fn(),
  resetPreferences: vi.fn(),
  resetDrafts: vi.fn(),
}));

vi.mock('@/shared/utils', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  IS_PLATFORM: false,
}));

vi.mock('@/shared/api', () => ({
  api: {
    auth: {
      status: (...args: unknown[]) => mocks.authStatus(...args),
      user: (...args: unknown[]) => mocks.authUser(...args),
      refresh: vi.fn(),
      login: vi.fn(),
      register: vi.fn(),
    },
    user: {
      onboardingStatus: (...args: unknown[]) => mocks.onboardingStatus(...args),
    },
  },
}));

vi.mock('@/shared/userSettings', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  hydrateUserPreferences: vi.fn(),
  resetUserPreferences: () => mocks.resetPreferences(),
}));

vi.mock('@/shared/chatDrafts', () => ({
  hydrateChatDrafts: vi.fn(),
  resetChatDrafts: () => mocks.resetDrafts(),
}));

const jsonResponse = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });

function AuthWrapper({ children }: { children: React.ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}

const renderAuth = () => renderHook(() => useAuth(), { wrapper: AuthWrapper });

const flushAuth = async () => {
  await act(async () => {
    for (let index = 0; index < 8; index += 1) {
      await Promise.resolve();
    }
  });
};

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  mocks.authStatus.mockResolvedValue(jsonResponse({ needsSetup: false }));
  mocks.authUser.mockResolvedValue(jsonResponse({ user: { username: 'mate' } }));
  mocks.onboardingStatus.mockResolvedValue(jsonResponse({ hasCompletedOnboarding: true }));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

test('only an auth rejection header rejects the stored session', () => {
  assert.equal(classifyAuthProbe(new Response(null, { status: 200 })), 'authenticated');
  assert.equal(classifyAuthProbe(new Response(null, { status: 401 })), 'unavailable');
  assert.equal(classifyAuthProbe(new Response(null, { status: 503 })), 'unavailable');
  assert.equal(
    classifyAuthProbe(new Response(null, {
      status: 401,
      headers: { 'X-Auth-Error': 'invalid-token' },
    })),
    'rejected',
  );
});

test('a rejection only ends the session for the token it checked', () => {
  assert.equal(rejectionEndsSession('token-a', 'token-a'), true);
  assert.equal(rejectionEndsSession('token-old', 'token-new'), false);
  assert.equal(rejectionEndsSession('token-a', null), false);
  assert.equal(rejectionEndsSession(null, null), false);
});

const viewState = (overrides: Partial<AuthViewState> = {}): AuthViewState => ({
  isLoading: false,
  isPlatform: false,
  needsSetup: false,
  hasToken: true,
  hasUser: true,
  authUnavailable: false,
  hasCompletedOnboarding: true,
  ...overrides,
});

test('an unavailable held session has its own route state', () => {
  assert.equal(resolveAuthView(viewState()), 'app');
  assert.equal(resolveAuthView(viewState({ hasUser: false, authUnavailable: true })), 'unavailable');
  assert.equal(
    resolveAuthView(viewState({ hasToken: false, hasUser: false, authUnavailable: true })),
    'login',
  );
  assert.equal(resolveAuthView(viewState({ hasToken: false, hasUser: false })), 'login');
  assert.equal(resolveAuthView(viewState({ isLoading: true, hasUser: false })), 'loading');
  assert.equal(resolveAuthView(viewState({ needsSetup: true, hasUser: false })), 'setup');
});

test('network failure keeps the token, preferences, and drafts', async () => {
  localStorage.setItem('auth-token', 'stored-token');
  mocks.authStatus.mockRejectedValue(new TypeError('offline'));

  const { result } = renderAuth();

  await waitFor(() => assert.equal(result.current.authUnavailable, true));
  assert.equal(result.current.user, null);
  assert.equal(result.current.token, 'stored-token');
  assert.equal(localStorage.getItem('auth-token'), 'stored-token');
  assert.equal(mocks.resetPreferences.mock.calls.length, 0);
  assert.equal(mocks.resetDrafts.mock.calls.length, 0);
});

test('a verified rejection clears the session data', async () => {
  localStorage.setItem('auth-token', 'rejected-token');
  mocks.authUser.mockResolvedValue(jsonResponse(
    {},
    401,
    { 'X-Auth-Error': 'invalid-token' },
  ));

  const { result } = renderAuth();

  await waitFor(() => assert.equal(result.current.token, null));
  assert.equal(result.current.authUnavailable, false);
  assert.equal(localStorage.getItem('auth-token'), null);
  assert.equal(mocks.resetPreferences.mock.calls.length, 1);
  assert.equal(mocks.resetDrafts.mock.calls.length, 1);
});

test('a superseded response cannot overwrite a newer authenticated result', async () => {
  localStorage.setItem('auth-token', 'stored-token');
  const olderResponse: { resolve?: (response: Response) => void } = {};
  mocks.authUser
    .mockImplementationOnce(() => new Promise<Response>((resolve) => {
      olderResponse.resolve = resolve;
    }))
    .mockResolvedValueOnce(jsonResponse({ user: { username: 'newer-user' } }));

  const { result } = renderAuth();
  await waitFor(() => assert.equal(mocks.authUser.mock.calls.length, 1));

  await act(async () => {
    await result.current.retryAuthCheck();
  });
  assert.equal(result.current.user?.username, 'newer-user');

  assert.ok(olderResponse.resolve);
  olderResponse.resolve(jsonResponse(
    {},
    401,
    { 'X-Auth-Error': 'invalid-token' },
  ));
  await flushAuth();

  assert.equal(result.current.user?.username, 'newer-user');
  assert.equal(result.current.token, 'stored-token');
  assert.equal(mocks.resetPreferences.mock.calls.length, 0);
});

test('unavailable auth retries on online, visibility, and timer changes', async () => {
  vi.useFakeTimers();
  localStorage.setItem('auth-token', 'stored-token');
  mocks.authUser.mockResolvedValue(jsonResponse({}, 503));

  const { result } = renderAuth();
  await flushAuth();
  assert.equal(result.current.authUnavailable, true);
  assert.equal(mocks.authUser.mock.calls.length, 1);

  window.dispatchEvent(new Event('online'));
  await flushAuth();
  assert.equal(mocks.authUser.mock.calls.length, 2);

  document.dispatchEvent(new Event('visibilitychange'));
  await flushAuth();
  assert.equal(mocks.authUser.mock.calls.length, 3);

  await act(async () => {
    vi.advanceTimersByTime(5000);
    await Promise.resolve();
  });
  await flushAuth();
  assert.equal(mocks.authUser.mock.calls.length, 4);
});

test('slow retries settle before another trigger starts a new probe', async () => {
  vi.useFakeTimers();
  localStorage.setItem('auth-token', 'stored-token');
  mocks.authUser.mockResolvedValue(jsonResponse({}, 503));

  const { result } = renderAuth();
  await flushAuth();
  assert.equal(result.current.authUnavailable, true);
  assert.equal(mocks.authUser.mock.calls.length, 1);

  const slowResponse: { resolve?: (response: Response) => void } = {};
  mocks.authUser.mockImplementationOnce(() => new Promise<Response>((resolve) => {
    slowResponse.resolve = resolve;
  }));

  window.dispatchEvent(new Event('online'));
  await flushAuth();
  assert.equal(mocks.authUser.mock.calls.length, 2);

  document.dispatchEvent(new Event('visibilitychange'));
  vi.advanceTimersByTime(15_000);
  void result.current.retryAuthCheck();
  await flushAuth();
  assert.equal(mocks.authUser.mock.calls.length, 2);

  assert.ok(slowResponse.resolve);
  slowResponse.resolve(jsonResponse({}, 503));
  await flushAuth();

  await act(async () => {
    await result.current.retryAuthCheck();
  });
  assert.equal(mocks.authUser.mock.calls.length, 3);

  vi.advanceTimersByTime(5000);
  await flushAuth();
  assert.equal(mocks.authUser.mock.calls.length, 4);
});
