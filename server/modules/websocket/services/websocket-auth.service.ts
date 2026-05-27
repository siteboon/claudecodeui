import type { VerifyClientCallbackSync } from 'ws';

import type { AuthenticatedWebSocketRequest } from '@/shared/types.js';

type WebSocketUser = {
  id?: string | number;
  userId?: string | number;
  username?: string;
  [key: string]: unknown;
};

type WebSocketAuthDependencies = {
  isPlatform: boolean;
  authenticateWebSocket: (token: string | null) => WebSocketUser | null;
  // Optional: resolve the user vouched for by a trusted reverse-proxy header on the
  // upgrade request (forward-auth / SSO). Mirrors the REST authenticateToken path.
  resolveTrustedProxyUser?: (
    req: AuthenticatedWebSocketRequest
  ) => WebSocketUser | null;
};

/**
 * Authenticates websocket upgrade requests before the `connection` handler runs.
 */
export function verifyWebSocketClient(
  info: Parameters<VerifyClientCallbackSync<AuthenticatedWebSocketRequest>>[0],
  dependencies: WebSocketAuthDependencies
): boolean {
  const request = info.req as AuthenticatedWebSocketRequest;
  console.log('WebSocket connection attempt to:', request.url);

  // Platform mode: use the first DB user and skip token checks.
  if (dependencies.isPlatform) {
    const user = dependencies.authenticateWebSocket(null);
    if (!user) {
      console.log('[WARN] Platform mode: No user found in database');
      return false;
    }

    request.user = user;
    console.log('[OK] Platform mode WebSocket authenticated for user:', user.username);
    return true;
  }

  // Trusted reverse-proxy header auth: the upstream proxy already verified the user, and
  // the upgrade request carries both the identity header and the proxy's source socket —
  // so this mirrors the REST authenticateToken path and needs no JWT on the WS handshake.
  const proxyUser = dependencies.resolveTrustedProxyUser?.(request);
  if (proxyUser) {
    request.user = proxyUser;
    console.log('[OK] WebSocket authenticated via trusted proxy for user:', proxyUser.username);
    return true;
  }

  // OSS mode: read JWT from query string first, then Authorization header.
  const upgradeUrl = new URL(request.url ?? '/', 'http://localhost');
  const token =
    upgradeUrl.searchParams.get('token') ??
    request.headers.authorization?.split(' ')[1] ??
    null;

  const user = dependencies.authenticateWebSocket(token);
  if (!user) {
    console.log('[WARN] WebSocket authentication failed');
    return false;
  }

  request.user = user;
  console.log('[OK] WebSocket authenticated for user:', user.username);
  return true;
}
