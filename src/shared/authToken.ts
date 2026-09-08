/**
 * The client's half of the JWT session: parsing, expiry, storage and the two
 * events the auth context listens to.
 *
 * Extracted from api.ts, which is meant to be the endpoint map plus its request
 * helpers. This is the security-sensitive part and it is what WebSocketContext,
 * AuthContext, the shell socket and the file-tree uploader actually import.
 */

export const AUTH_TOKEN_REFRESHED_EVENT = 'auth-token-refreshed';
export const AUTH_SESSION_EXPIRED_EVENT = 'auth-session-expired';

// Only accept a refreshed token that has this app's issued JWT shape
// (three base64url segments). An attacker-injected/malformed header value
// must never overwrite the stored auth token.
export const isValidRefreshedToken = (token: unknown): token is string =>
  typeof token === 'string' &&
  /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token);

type TokenClaims = {
  issuedAt: number;
  expiresAt: number;
  subject: string | null;
};

const readTokenClaims = (token: unknown): TokenClaims | null => {
  if (!isValidRefreshedToken(token)) {
    return null;
  }

  try {
    const encodedPayload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const paddedPayload = encodedPayload.padEnd(
      encodedPayload.length + ((4 - (encodedPayload.length % 4)) % 4),
      '=',
    );
    const payload = JSON.parse(atob(paddedPayload)) as {
      iat?: unknown;
      exp?: unknown;
      userId?: unknown;
      username?: unknown;
    };

    if (
      typeof payload.iat !== 'number' ||
      !Number.isFinite(payload.iat) ||
      typeof payload.exp !== 'number' ||
      !Number.isFinite(payload.exp)
    ) {
      return null;
    }

    const subject =
      payload.userId !== undefined &&
      payload.userId !== null &&
      typeof payload.username === 'string'
        ? `${String(payload.userId)}|${payload.username}`
        : null;

    return { issuedAt: payload.iat * 1000, expiresAt: payload.exp * 1000, subject };
  } catch {
    return null;
  }
};

// Tolerance for client/server clock skew. The server's own jwt.verify is the
// real authority; this check only decides whether the client should discard a
// token locally. Without an allowance, a browser clock running slightly ahead
// reads a still-server-valid token as expired and drops the session.
export const TOKEN_EXPIRY_SKEW_MS = 60_000;

export const isAuthTokenExpired = (token: unknown): boolean => {
  const claims = readTokenClaims(token);
  return claims ? Date.now() >= claims.expiresAt + TOKEN_EXPIRY_SKEW_MS : false;
};

export const getAuthTokenRefreshDelay = (token: unknown): number | null => {
  const claims = readTokenClaims(token);
  if (!claims) {
    return null;
  }

  const refreshAt = claims.issuedAt + ((claims.expiresAt - claims.issuedAt) / 2);
  return Math.max(0, refreshAt - Date.now());
};

export const expireAuthSession = (): void => {
  localStorage.removeItem('auth-token');
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(AUTH_SESSION_EXPIRED_EVENT));
  }
};

export const getStoredAuthToken = (): string | null => {
  const token = localStorage.getItem('auth-token');
  if (token && isAuthTokenExpired(token)) {
    expireAuthSession();
    return null;
  }
  return token;
};

export const storeAuthToken = (token: unknown): boolean => {
  if (!isValidRefreshedToken(token)) {
    return false;
  }

  // The server mints a fresh token on every request past the half-life, and
  // /api/auth/refresh mints one unconditionally — jwt `iat` is per-second, so
  // concurrent requests come back with *different* tokens. Every application
  // re-fires AUTH_TOKEN_REFRESHED_EVENT and rebuilds whatever is keyed on the
  // token (the chat websocket, the auth-status check, the refresh timer); with
  // two tokens in flight the client ping-pongs between them indefinitely. A
  // same-user token that is not strictly newer changes nothing, so keep the
  // stored one. A different user's token (login) always applies.
  const stored = localStorage.getItem('auth-token');
  if (stored === token) {
    return true;
  }
  const incoming = readTokenClaims(token);
  const current = readTokenClaims(stored);
  if (
    incoming !== null &&
    current !== null &&
    incoming.issuedAt <= current.issuedAt &&
    incoming.subject !== null &&
    incoming.subject === current.subject
  ) {
    return true;
  }

  localStorage.setItem('auth-token', token);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(AUTH_TOKEN_REFRESHED_EVENT, { detail: token }));
  }
  return true;
};
