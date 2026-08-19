import type { ApiErrorPayload } from './types';

export async function parseJsonSafely<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

export function resolveApiErrorMessage(payload: ApiErrorPayload | null, fallback: string): string {
  if (!payload) {
    return fallback;
  }

  return payload.error ?? payload.message ?? fallback;
}

/**
 * Outcome of probing `/api/auth/user` with a stored token.
 *
 * `unavailable` is deliberately distinct from `rejected`: a proxy 502, a gateway
 * timeout or an unreachable server says nothing about whether the stored token
 * is still valid. Treating those as a rejection signs the user out of a
 * perfectly good session - which is what an installed PWA hits, because it
 * re-runs this probe on every cold start.
 */
export type AuthProbeResult = 'authenticated' | 'rejected' | 'unavailable';

export function classifyAuthProbe(response: Response): AuthProbeResult {
  if (response.ok) {
    return 'authenticated';
  }

  // The server marks a genuinely bad token with 401/403 plus X-Auth-Error.
  // Only that verdict may end the session; anything else is inconclusive.
  if (response.status === 401 || response.status === 403) {
    return 'rejected';
  }

  return response.headers.get('X-Auth-Error') ? 'rejected' : 'unavailable';
}

/** Which top-level screen the auth state resolves to. */
export type AuthView = 'loading' | 'setup' | 'unavailable' | 'login' | 'onboarding' | 'app';

export type AuthViewState = {
  isLoading: boolean;
  isPlatform: boolean;
  needsSetup: boolean;
  hasToken: boolean;
  hasUser: boolean;
  authUnavailable: boolean;
  hasCompletedOnboarding: boolean;
};

/**
 * Precedence of the auth screens, kept in one place because the ordering is the
 * actual contract: a held-but-unverified token must resolve to `unavailable`
 * rather than `login`, or a cold-started PWA discards a working session every
 * time it cannot reach the server.
 */
export function resolveAuthView(state: AuthViewState): AuthView {
  if (state.isLoading) {
    return 'loading';
  }

  if (state.isPlatform) {
    return state.hasCompletedOnboarding ? 'app' : 'onboarding';
  }

  if (state.needsSetup) {
    return 'setup';
  }

  if (!state.hasUser) {
    // Without a token there is genuinely nobody signed in, so the login form is
    // correct even while the server is unreachable.
    return state.hasToken && state.authUnavailable ? 'unavailable' : 'login';
  }

  return state.hasCompletedOnboarding ? 'app' : 'onboarding';
}
