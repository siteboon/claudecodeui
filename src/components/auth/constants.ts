export const AUTH_TOKEN_STORAGE_KEY = 'auth-token';

export const AUTH_ERROR_MESSAGES = {
  authStatusCheckFailed: 'Failed to check authentication status',
  loginFailed: 'Login failed',
  registrationFailed: 'Registration failed',
  networkError: 'Network error. Please try again.',
  sessionExpired: 'Your session expired. Please log in again.',
  authUnavailable: 'Cannot reach the server. Your session is kept - retrying...',
} as const;

/** Delay between automatic retries while the auth check stays inconclusive. */
export const AUTH_RETRY_INTERVAL_MS = 5000;
