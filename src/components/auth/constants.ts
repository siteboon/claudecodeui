export const AUTH_TOKEN_STORAGE_KEY = 'auth-token';

// Dispatched on `window` whenever the server sends an X-Refreshed-Token
// header in response to an authenticated request. Lets AuthContext sync the
// new token into its React state so consumers (e.g. WebSocketContext) reopen
// connections with the refreshed credential instead of the soon-to-expire one.
export const AUTH_TOKEN_REFRESHED_EVENT = 'auth-token-refreshed';

export const AUTH_ERROR_MESSAGES = {
  authStatusCheckFailed: 'Failed to check authentication status',
  loginFailed: 'Login failed',
  registrationFailed: 'Registration failed',
  networkError: 'Network error. Please try again.',
} as const;
