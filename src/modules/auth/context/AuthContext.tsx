import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { IS_PLATFORM } from '@/shared/utils';
import { api } from '@/shared/api';
import { AUTH_SESSION_EXPIRED_EVENT, AUTH_TOKEN_REFRESHED_EVENT, getAuthTokenRefreshDelay, isValidRefreshedToken, storeAuthToken } from '@/shared/authToken';
import { hydrateChatDrafts, resetChatDrafts } from '@/shared/chatDrafts';
import { hydrateUserPreferences, resetUserPreferences } from '@/shared/userSettings';
/** The signed-in account held by AuthContext - a required `username` plus an optional id and any additional fields the auth API returns - and should be read through `useAuth()` rather than re-derived from raw auth responses. */
export type AuthUser = {
  id?: number | string;
  username: string;
  [key: string]: unknown;
};

const AUTH_TOKEN_STORAGE_KEY = 'auth-token';

const AUTH_ERROR_MESSAGES = {
  loginFailed: 'Login failed',
  registrationFailed: 'Registration failed',
  networkError: 'Network error. Please try again.',
  sessionExpired: 'Your session expired. Please log in again.',
  authUnavailable: 'Cannot reach the server. Your session is kept while CloudCLI retries.',
} as const;

const AUTH_RETRY_INTERVAL_MS = 5000;

type AuthActionResult = { success: true } | { success: false; error: string };

type AuthSessionPayload = {
  token?: string;
  user?: AuthUser;
  error?: string;
  message?: string;
};

type AuthStatusPayload = {
  needsSetup?: boolean;
};

type AuthUserPayload = {
  user?: AuthUser;
};

type OnboardingStatusPayload = {
  hasCompletedOnboarding?: boolean;
};

type ApiErrorPayload = {
  error?: string;
  message?: string;
};

export type AuthContextValue = {
  user: AuthUser | null;
  token: string | null;
  isLoading: boolean;
  needsSetup: boolean;
  hasCompletedOnboarding: boolean;
  error: string | null;
  authUnavailable: boolean;
  login: (username: string, password: string) => Promise<AuthActionResult>;
  register: (username: string, password: string) => Promise<AuthActionResult>;
  logout: () => void;
  refreshOnboardingStatus: () => Promise<void>;
  retryAuthCheck: () => Promise<void>;
};

type AuthProviderProps = {
  children: ReactNode;
};

async function parseJsonSafely<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

function resolveApiErrorMessage(payload: ApiErrorPayload | null, fallback: string): string {
  if (!payload) {
    return fallback;
  }

  return payload.error ?? payload.message ?? fallback;
}

export type AuthProbeResult = 'authenticated' | 'rejected' | 'unavailable';

export function classifyAuthProbe(response: Response): AuthProbeResult {
  if (response.ok) {
    return 'authenticated';
  }

  return response.headers.get('X-Auth-Error') ? 'rejected' : 'unavailable';
}

export function rejectionEndsSession(
  sentToken: string | null,
  storedToken: string | null,
): boolean {
  return sentToken !== null && sentToken === storedToken;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const readStoredToken = (): string | null => localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);

const persistToken = (token: string) => {
  storeAuthToken(token);
};

const clearStoredToken = () => {
  localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
};

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }

  return context;
}

/** Used by App to expose the session, and its login/logout actions, to every module through useAuth. */
export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(() => readStoredToken());
  const [isLoading, setIsLoading] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [authUnavailable, setAuthUnavailable] = useState(false);
  const authProbeId = useRef(0);
  const retryInFlight = useRef<Promise<void> | null>(null);

  const setSession = useCallback((nextUser: AuthUser, nextToken: string) => {
    authProbeId.current += 1;
    retryInFlight.current = null;
    setUser(nextUser);
    setToken(nextToken);
    setAuthUnavailable(false);
    persistToken(nextToken);
  }, []);

  const clearSession = useCallback(() => {
    authProbeId.current += 1;
    setUser(null);
    retryInFlight.current = null;
    setToken(null);
    setAuthUnavailable(false);
    clearStoredToken();
    // Otherwise the next person to sign in on this device would start out
    // looking at the previous user's theme, language, permissions and drafts.
    resetUserPreferences();
    resetChatDrafts();
  }, []);

  // Preferences live in auth.db, so they can only be fetched once there is a
  // user to fetch them for. Until this resolves, every reader falls back to the
  // localStorage mirror of the last known server state.
  const userKey = user ? String(user.id ?? user.username) : null;
  useEffect(() => {
    if (!userKey) {
      return;
    }
    void hydrateUserPreferences();
    void hydrateChatDrafts();
  }, [userKey]);

  const checkOnboardingStatus = useCallback(async () => {
    try {
      const response = await api.user.onboardingStatus();
      if (!response.ok) {
        return;
      }

      const payload = await parseJsonSafely<OnboardingStatusPayload>(response);
      setHasCompletedOnboarding(Boolean(payload?.hasCompletedOnboarding));
    } catch (caughtError) {
      console.error('Error checking onboarding status:', caughtError);
      // Fail open to avoid blocking access on transient onboarding status errors.
      setHasCompletedOnboarding(true);
    }
  }, []);

  const refreshOnboardingStatus = useCallback(async () => {
    await checkOnboardingStatus();
  }, [checkOnboardingStatus]);

  const refreshSession = useCallback(async () => {
    if (IS_PLATFORM || !token || !user) {
      return;
    }

    try {
      const response = await api.auth.refresh();
      if (!response.ok) {
        return;
      }

      const payload = await parseJsonSafely<AuthSessionPayload>(response);
      if (isValidRefreshedToken(payload?.token)) {
        setToken(payload.token);
        persistToken(payload.token);
      }
    } catch (caughtError) {
      // A transient network failure must not sign the user out. Focus/visibility
      // and the next scheduled refresh will retry while the token remains valid.
      console.warn('[Auth] Session refresh failed:', caughtError);
    }
  }, [token, user]);

  useEffect(() => {
    const handleTokenRefreshed = (event: Event) => {
      const nextToken = (event as CustomEvent<unknown>).detail;
      if (isValidRefreshedToken(nextToken)) {
        authProbeId.current += 1;
        retryInFlight.current = null;
        setToken(nextToken);
      }
    };
    const handleSessionExpired = () => {
      clearSession();
      setError(AUTH_ERROR_MESSAGES.sessionExpired);
    };

    window.addEventListener(AUTH_TOKEN_REFRESHED_EVENT, handleTokenRefreshed);
    window.addEventListener(AUTH_SESSION_EXPIRED_EVENT, handleSessionExpired);
    return () => {
      window.removeEventListener(AUTH_TOKEN_REFRESHED_EVENT, handleTokenRefreshed);
      window.removeEventListener(AUTH_SESSION_EXPIRED_EVENT, handleSessionExpired);
    };
  }, [clearSession]);

  const checkAuthStatus = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false;
    const probeId = (authProbeId.current += 1);
    const superseded = () => authProbeId.current !== probeId;

    try {
      if (!silent) {
        setIsLoading(true);
      }
      setError(null);

      const statusResponse = await api.auth.status();
      const statusPayload = await parseJsonSafely<AuthStatusPayload>(statusResponse);

      if (superseded()) {
        return;
      }

      if (statusResponse.ok && statusPayload?.needsSetup) {
        setNeedsSetup(true);
        setAuthUnavailable(false);
        return;
      }

      if (!statusResponse.ok) {
        if (token) {
          setAuthUnavailable(true);
          setError(AUTH_ERROR_MESSAGES.authUnavailable);
        } else {
          setError(AUTH_ERROR_MESSAGES.networkError);
        }
        return;
      }

      setNeedsSetup(false);

      if (!token) {
        setAuthUnavailable(false);
        return;
      }

      const sentToken = token;
      const userResponse = await api.auth.user();
      const probe = classifyAuthProbe(userResponse);

      if (superseded()) {
        return;
      }

      if (probe === 'rejected') {
        if (rejectionEndsSession(sentToken, readStoredToken())) {
          clearSession();
          setError(AUTH_ERROR_MESSAGES.sessionExpired);
        }
        return;
      }

      const userPayload = probe === 'authenticated'
        ? await parseJsonSafely<AuthUserPayload>(userResponse)
        : null;

      if (superseded()) {
        return;
      }

      if (!userPayload?.user) {
        setAuthUnavailable(true);
        setError(AUTH_ERROR_MESSAGES.authUnavailable);
        return;
      }

      setUser(userPayload.user);
      setAuthUnavailable(false);
      await checkOnboardingStatus();
    } catch (caughtError) {
      console.warn('[Auth] Auth status check could not complete:', caughtError);

      if (superseded()) {
        return;
      }

      if (token) {
        setAuthUnavailable(true);
        setError(AUTH_ERROR_MESSAGES.authUnavailable);
      } else {
        setError(AUTH_ERROR_MESSAGES.networkError);
      }
    } finally {
      if (!superseded()) {
        setIsLoading(false);
      }
    }
  }, [checkOnboardingStatus, clearSession, token]);

  useEffect(() => {
    if (IS_PLATFORM) {
      setUser({ username: 'platform-user' });
      setNeedsSetup(false);
      void checkOnboardingStatus().finally(() => {
        setIsLoading(false);
      });
      return;
    }

    void checkAuthStatus();
  }, [checkAuthStatus, checkOnboardingStatus]);

  const retryAuthCheck = useCallback((): Promise<void> => {
    if (retryInFlight.current) {
      return retryInFlight.current;
    }

    const retry = checkAuthStatus({ silent: true }).finally(() => {
      if (retryInFlight.current === retry) {
        retryInFlight.current = null;
      }
    });
    retryInFlight.current = retry;
    return retry;
  }, [checkAuthStatus]);

  useEffect(() => {
    if (IS_PLATFORM || !authUnavailable || !token || user) {
      return undefined;
    }

    const retry = () => void retryAuthCheck();
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        retry();
      }
    };

    const retryTimer = window.setInterval(retry, AUTH_RETRY_INTERVAL_MS);
    window.addEventListener('online', retry);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.clearInterval(retryTimer);
      window.removeEventListener('online', retry);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [authUnavailable, retryAuthCheck, token, user]);

  useEffect(() => {
    if (IS_PLATFORM || !token || !user) {
      return undefined;
    }

    const refreshIfNeeded = () => {
      const refreshDelay = getAuthTokenRefreshDelay(token);
      if (refreshDelay !== null && refreshDelay <= 0) {
        void refreshSession();
      }
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refreshIfNeeded();
      }
    };

    const refreshDelay = getAuthTokenRefreshDelay(token);
    const refreshTimer = refreshDelay === null
      ? null
      : window.setTimeout(() => void refreshSession(), refreshDelay);

    window.addEventListener('focus', refreshIfNeeded);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      if (refreshTimer !== null) {
        window.clearTimeout(refreshTimer);
      }
      window.removeEventListener('focus', refreshIfNeeded);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [refreshSession, token, user]);

  const login = useCallback<AuthContextValue['login']>(
    async (username, password) => {
      try {
        setError(null);
        const response = await api.auth.login(username, password);
        const payload = await parseJsonSafely<AuthSessionPayload>(response);

        if (!response.ok || !payload?.token || !payload.user) {
          const message = resolveApiErrorMessage(payload, AUTH_ERROR_MESSAGES.loginFailed);
          setError(message);
          return { success: false, error: message };
        }

        setSession(payload.user, payload.token);
        setNeedsSetup(false);
        await checkOnboardingStatus();
        return { success: true };
      } catch (caughtError) {
        console.error('Login error:', caughtError);
        setError(AUTH_ERROR_MESSAGES.networkError);
        return { success: false, error: AUTH_ERROR_MESSAGES.networkError };
      }
    },
    [checkOnboardingStatus, setSession],
  );

  const register = useCallback<AuthContextValue['register']>(
    async (username, password) => {
      try {
        setError(null);
        const response = await api.auth.register(username, password);
        const payload = await parseJsonSafely<AuthSessionPayload>(response);

        if (!response.ok || !payload?.token || !payload.user) {
          const message = resolveApiErrorMessage(payload, AUTH_ERROR_MESSAGES.registrationFailed);
          setError(message);
          return { success: false, error: message };
        }

        setSession(payload.user, payload.token);
        setNeedsSetup(false);
        await checkOnboardingStatus();
        return { success: true };
      } catch (caughtError) {
        console.error('Registration error:', caughtError);
        setError(AUTH_ERROR_MESSAGES.networkError);
        return { success: false, error: AUTH_ERROR_MESSAGES.networkError };
      }
    },
    [checkOnboardingStatus, setSession],
  );

  const logout = useCallback(() => {
    // JWT logout is client-side: the server endpoint does not maintain a
    // revocation list, so clearing the session is the complete operation.
    clearSession();
  }, [clearSession]);

  const contextValue = useMemo<AuthContextValue>(
    () => ({
      user,
      token,
      isLoading,
      needsSetup,
      hasCompletedOnboarding,
      error,
      authUnavailable,
      login,
      register,
      logout,
      refreshOnboardingStatus,
      retryAuthCheck,
    }),
    [
      authUnavailable,
      error,
      hasCompletedOnboarding,
      isLoading,
      login,
      logout,
      needsSetup,
      refreshOnboardingStatus,
      register,
      retryAuthCheck,
      token,
      user,
    ],
  );

  return <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>;
}
