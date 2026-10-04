import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ReactNode } from 'react';

import { IS_PLATFORM } from '@/shared/utils';
import { api } from '@/shared/api';
import {
  AUTH_SESSION_EXPIRED_EVENT,
  AUTH_TOKEN_REFRESHED_EVENT,
  getAuthTokenRefreshDelay,
  isValidRefreshedToken,
  storeAuthToken,
} from '@/shared/authToken';
import { hydrateChatDrafts, resetChatDrafts } from '@/shared/chatDrafts';
import { hydrateUserPreferences, resetUserPreferences } from '@/shared/userSettings';

/** The signed-in account held by AuthContext - a required `username` plus an optional id and any additional fields the auth API returns - and should be read through `useAuth()` rather than re-derived from raw auth responses. */
type AuthUser = {
  id?: number | string;
  username: string;
  [key: string]: unknown;
};

const AUTH_TOKEN_STORAGE_KEY = 'auth-token';

const AUTH_ERROR_MESSAGES = {
  authStatusCheckFailed: 'errors.authStatusCheckFailed',
  loginFailed: 'errors.loginFailed',
  registrationFailed: 'errors.registrationFailed',
  networkError: 'errors.networkError',
  sessionExpired: 'errors.sessionExpired',
} as const;

type AuthActionResult =
  | { success: true }
  | { success: false; error: string; totpRequired?: boolean };

type AuthActionOptions = {
  deferPublish?: boolean;
};

type StructuredErrorObject = {
  code?: string;
  message?: string;
  details?: { totpRequired?: boolean };
};

type AuthSessionPayload = {
  token?: string;
  user?: AuthUser;
  error?: string | StructuredErrorObject;
  message?: string;
};

type AuthStatusPayload = {
  needsSetup?: boolean;
  totpEnabled?: boolean;
};

type AuthUserPayload = {
  user?: AuthUser;
};

type OnboardingStatusPayload = {
  hasCompletedOnboarding?: boolean;
};

type ApiErrorPayload = {
  error?: string | StructuredErrorObject;
  message?: string;
};

type AuthContextValue = {
  user: AuthUser | null;
  token: string | null;
  isLoading: boolean;
  needsSetup: boolean;
  totpEnabled: boolean;
  hasCompletedOnboarding: boolean;
  error: string | null;
  login: (
    username: string,
    password: string,
    totpCode?: string,
    options?: AuthActionOptions,
  ) => Promise<AuthActionResult>;
  register: (
    username: string,
    password: string,
    options?: AuthActionOptions,
  ) => Promise<AuthActionResult>;
  completeDeferredSession: () => Promise<void>;
  logout: () => void;
  refreshOnboardingStatus: () => Promise<void>;
};

type AuthProviderProps = {
  children: ReactNode;
};

/**
 * Parses a fetch Response as JSON, returning null if parsing fails.
 */
async function parseJsonSafely<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

/**
 * Extracts a human-readable error message from either a legacy string envelope
 * or a structured AppError response object.
 */
function resolveApiErrorMessage(payload: ApiErrorPayload | null, fallback: string): string {
  if (!payload) {
    return fallback;
  }

  if (typeof payload.error === 'string' && payload.error) {
    return payload.error;
  }

  if (
    payload.error &&
    typeof payload.error === 'object' &&
    typeof payload.error.message === 'string'
  ) {
    return payload.error.message;
  }

  return payload.message ?? fallback;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Reads the persisted JWT token from localStorage.
 */
const readStoredToken = (): string | null => localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);

/**
 * Persists a JWT token to localStorage.
 */
const persistToken = (token: string) => {
  storeAuthToken(token);
};

/**
 * Removes the stored JWT token from localStorage.
 */
const clearStoredToken = () => {
  localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
};

/**
 * Hook returning the active authentication context value.
 */
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }

  return context;
}

/** Used by App to expose the session, and its login/logout actions, to every module through useAuth. */
export function AuthProvider({ children }: AuthProviderProps) {
  const { t } = useTranslation('auth');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(() => readStoredToken());
  const [isLoading, setIsLoading] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [totpEnabled, setTotpEnabled] = useState(false);
  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const deferredSessionRef = useRef<{ user: AuthUser; token: string } | null>(null);

  const clearSession = useCallback(() => {
    deferredSessionRef.current = null;
    setUser(null);
    setToken(null);
    clearStoredToken();
    resetUserPreferences();
    resetChatDrafts();
  }, []);

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
      console.warn('[Auth] Session refresh failed:', caughtError);
    }
  }, [token, user]);

  useEffect(() => {
    const handleTokenRefreshed = (event: Event) => {
      const nextToken = (event as CustomEvent<unknown>).detail;
      if (isValidRefreshedToken(nextToken)) {
        setToken(nextToken);
      }
    };
    const handleSessionExpired = () => {
      clearSession();
      setError(t(AUTH_ERROR_MESSAGES.sessionExpired));
    };

    window.addEventListener(AUTH_TOKEN_REFRESHED_EVENT, handleTokenRefreshed);
    window.addEventListener(AUTH_SESSION_EXPIRED_EVENT, handleSessionExpired);
    return () => {
      window.removeEventListener(AUTH_TOKEN_REFRESHED_EVENT, handleTokenRefreshed);
      window.removeEventListener(AUTH_SESSION_EXPIRED_EVENT, handleSessionExpired);
    };
  }, [clearSession, t]);

  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);

  const checkAuthStatus = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const statusResponse = await api.auth.status();
      const statusPayload = await parseJsonSafely<AuthStatusPayload>(statusResponse);

      setTotpEnabled(Boolean(statusPayload?.totpEnabled));

      if (statusPayload?.needsSetup) {
        setNeedsSetup(true);
        return;
      }

      setNeedsSetup(false);

      if (!readStoredToken()) {
        return;
      }

      const userResponse = await api.auth.user();
      if (!userResponse.ok) {
        clearSession();
        return;
      }

      const userPayload = await parseJsonSafely<AuthUserPayload>(userResponse);
      if (!userPayload?.user) {
        clearSession();
        return;
      }

      setUser(userPayload.user);
      await checkOnboardingStatus();
    } catch (caughtError) {
      console.error('[Auth] Auth status check failed:', caughtError);
      setError(tRef.current(AUTH_ERROR_MESSAGES.authStatusCheckFailed));
    } finally {
      setIsLoading(false);
    }
  }, [checkOnboardingStatus, clearSession]);

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
    const refreshTimer =
      refreshDelay === null
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

  const publishSession = useCallback(
    async (nextUser: AuthUser, nextToken: string) => {
      persistToken(nextToken);
      await checkOnboardingStatus();
      setUser(nextUser);
      setToken(nextToken);
      setNeedsSetup(false);
    },
    [checkOnboardingStatus],
  );

  const completeDeferredSession = useCallback(async () => {
    const pending = deferredSessionRef.current;
    if (!pending) {
      return;
    }
    deferredSessionRef.current = null;
    await publishSession(pending.user, pending.token);
  }, [publishSession]);

  const login = useCallback<AuthContextValue['login']>(
    async (username, password, totpCode, options) => {
      try {
        setError(null);
        const response = await api.auth.login(username, password, totpCode);
        const payload = await parseJsonSafely<AuthSessionPayload>(response);

        if (!response.ok || !payload?.token || !payload.user) {
          const message = resolveApiErrorMessage(payload, t(AUTH_ERROR_MESSAGES.loginFailed));
          const errorObj =
            payload?.error && typeof payload.error === 'object' ? payload.error : null;
          const totpRequired = Boolean(
            errorObj?.details?.totpRequired ||
              errorObj?.code === 'AUTH_TOTP_REQUIRED' ||
              errorObj?.code === 'AUTH_TOTP_INVALID',
          );
          if (totpRequired) {
            setTotpEnabled(true);
          }
          setError(message);
          return { success: false, error: message, totpRequired };
        }

        if (options?.deferPublish) {
          persistToken(payload.token);
          deferredSessionRef.current = { user: payload.user, token: payload.token };
          return { success: true };
        }

        await publishSession(payload.user, payload.token);
        return { success: true };
      } catch (caughtError) {
        console.error('Login error:', caughtError);
        setError(t(AUTH_ERROR_MESSAGES.networkError));
        return { success: false, error: t(AUTH_ERROR_MESSAGES.networkError) };
      }
    },
    [publishSession, t],
  );

  const register = useCallback<AuthContextValue['register']>(
    async (username, password, options) => {
      try {
        setError(null);
        const response = await api.auth.register(username, password);
        const payload = await parseJsonSafely<AuthSessionPayload>(response);

        if (!response.ok || !payload?.token || !payload.user) {
          const message = resolveApiErrorMessage(
            payload,
            t(AUTH_ERROR_MESSAGES.registrationFailed),
          );
          setError(message);
          return { success: false, error: message };
        }

        if (options?.deferPublish) {
          persistToken(payload.token);
          deferredSessionRef.current = { user: payload.user, token: payload.token };
          return { success: true };
        }

        await publishSession(payload.user, payload.token);
        return { success: true };
      } catch (caughtError) {
        console.error('Registration error:', caughtError);
        setError(t(AUTH_ERROR_MESSAGES.networkError));
        return { success: false, error: t(AUTH_ERROR_MESSAGES.networkError) };
      }
    },
    [publishSession, t],
  );

  const logout = useCallback(() => {
    clearSession();
  }, [clearSession]);

  const contextValue = useMemo<AuthContextValue>(
    () => ({
      user,
      token,
      isLoading,
      needsSetup,
      totpEnabled,
      hasCompletedOnboarding,
      error,
      login,
      register,
      completeDeferredSession,
      logout,
      refreshOnboardingStatus,
    }),
    [
      completeDeferredSession,
      error,
      hasCompletedOnboarding,
      isLoading,
      login,
      logout,
      needsSetup,
      totpEnabled,
      refreshOnboardingStatus,
      register,
      token,
      user,
    ],
  );

  return <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>;
}
