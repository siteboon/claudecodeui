export const AUTH_TOKEN_STORAGE_KEY = 'auth-token';

export const AUTH_ERROR_MESSAGES = {
  authStatusCheckFailed: 'Failed to check authentication status',
  loginFailed: 'Login failed',
  registrationFailed: 'Registration failed',
  networkError: 'Network error. Please try again.',
} as const;

// Server issues 7-day JWTs and only refreshes them once a request arrives
// past the token's half-life (see server/middleware/auth.js). A tab left
// open with no user-triggered requests (idle WS/SSE clients) would never
// send that request and would eventually reconnect with an expired token.
// Proactively pinging an authenticated endpoint on this interval keeps the
// token refreshed well before that half-life, without depending on user
// activity. Kept well under half of the 7-day lifetime (3.5 days).
export const TOKEN_REFRESH_CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
