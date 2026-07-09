// Tolerance for client/server clock skew. This check only decides whether to
// keep retrying a WS reconnect — the server's own `jwt.verify` (which has no
// skew allowance) is the real authority. Without this, a client clock running
// even slightly ahead of the server could read a still-server-valid token as
// expired and force an unwanted logout on a plain WS close.
export const TOKEN_EXPIRY_SKEW_MS = 60_000;

/**
 * Reads the `exp` claim out of a JWT without verifying its signature — this
 * only needs to detect "this token cannot possibly still be valid" so a
 * reconnect loop can stop, not to authenticate anything. The server remains
 * the sole source of truth for verification.
 */
export const isTokenExpired = (token: string | null): boolean => {
  if (!token) return true;

  const payloadSegment = token.split('.')[1];
  if (!payloadSegment) return true;

  try {
    const normalized = payloadSegment.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
    const payload = JSON.parse(atob(padded)) as { exp?: number };
    return typeof payload.exp !== 'number' || Date.now() >= payload.exp * 1000 + TOKEN_EXPIRY_SKEW_MS;
  } catch {
    // Unreadable token shape — treat as expired rather than retrying forever.
    return true;
  }
};
