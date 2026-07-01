import type { Server as HttpServer } from 'node:http';

import { WebSocket, WebSocketServer, type VerifyClientCallbackSync } from 'ws';

import { handleChatConnection } from '@/modules/websocket/services/chat-websocket.service.js';
import { VIEWER_COOKIE_NAME } from '@/modules/browser-use/index.js';
import { verifyWebSocketClient } from '@/modules/websocket/services/websocket-auth.service.js';
import { handlePluginWsProxy } from '@/modules/websocket/services/plugin-websocket-proxy.service.js';
import { handleShellConnection } from '@/modules/websocket/services/shell-websocket.service.js';
import { handleDesktopNotificationsConnection } from '@/modules/notifications/index.js';
import type { AuthenticatedWebSocketRequest } from '@/shared/types.js';

type WebSocketServerDependencies = {
  verifyClient: Parameters<typeof verifyWebSocketClient>[1];
  chat: Parameters<typeof handleChatConnection>[2];
  shell: Parameters<typeof handleShellConnection>[1];
  getPluginPort: Parameters<typeof handlePluginWsProxy>[2];
  browserUseViewer?: (ws: WebSocket, pathname: string) => void;
  authenticateBrowserUseViewer?: (pathname: string, token: string | null) => boolean;
};

function readCookieValue(header: unknown, name: string): string | null {
  if (!header) return null;
  const prefix = `${name}=`;
  const cookie = String(header).split(';').map((part) => part.trim()).find((part) => part.startsWith(prefix));
  return cookie ? decodeURIComponent(cookie.slice(prefix.length)) : null;
}

function getBrowserUseViewerToken(url: URL, headers: Record<string, unknown>): string | null {
  return url.searchParams.get('viewerToken') || readCookieValue(headers.cookie, VIEWER_COOKIE_NAME);
}

/**
 * Creates and wires the server-wide websocket gateway used for chat, shell, and
 * plugin proxy routes.
 */
export function createWebSocketServer(
  server: HttpServer,
  dependencies: WebSocketServerDependencies
): WebSocketServer {
  const wss = new WebSocketServer({
    server,
    verifyClient: ((
      info: Parameters<VerifyClientCallbackSync<AuthenticatedWebSocketRequest>>[0]
    ) => {
      const requestUrl = new URL(info.req.url ?? '/', 'http://localhost');
      if (
        requestUrl.pathname.startsWith('/api/browser-use/sessions/')
        && requestUrl.pathname.endsWith('/viewer/websockify')
      ) {
        const token = getBrowserUseViewerToken(requestUrl, info.req.headers as Record<string, unknown>);
        return Boolean(dependencies.authenticateBrowserUseViewer?.(requestUrl.pathname, token));
      }
      return verifyWebSocketClient(info, dependencies.verifyClient);
    }),
  });

  wss.on('connection', (ws, request) => {
    // Keep WebSocket alive across reverse-proxy idle timeouts (Cloudflare ~100s,
    // AWS ALB 60s, nginx 60s, etc.). Without app-level pings these connections
    // are silently torn down even when the UI is active, causing repeated
    // reconnect cycles. ws library heartbeat is opt-in.
    const HEARTBEAT_INTERVAL_MS = 30_000;
    const heartbeat = setInterval(() => {
      if (ws.readyState === ws.OPEN) {
        try {
          ws.ping();
        } catch {
          // socket may have been closed concurrently — interval will be cleared below
        }
      }
    }, HEARTBEAT_INTERVAL_MS);
    const stopHeartbeat = () => clearInterval(heartbeat);
    ws.on('close', stopHeartbeat);
    ws.on('error', stopHeartbeat);

    const incomingRequest = request as AuthenticatedWebSocketRequest;
    const url = incomingRequest.url ?? '/';
    const pathname = new URL(url, 'http://localhost').pathname;

    if (pathname === '/shell') {
      handleShellConnection(ws, dependencies.shell);
      return;
    }

    if (pathname === '/ws') {
      handleChatConnection(ws, incomingRequest, dependencies.chat);
      return;
    }

    if (pathname === '/desktop-notifications') {
      handleDesktopNotificationsConnection(ws, incomingRequest);
      return;
    }

    if (pathname.startsWith('/plugin-ws/')) {
      handlePluginWsProxy(ws, pathname, dependencies.getPluginPort);
      return;
    }

    if (pathname.startsWith('/api/browser-use/sessions/') && pathname.endsWith('/viewer/websockify')) {
      dependencies.browserUseViewer?.(ws, pathname);
      return;
    }

    console.log('[WARN] Unknown WebSocket path:', pathname);
    ws.close();
  });

  return wss;
}
