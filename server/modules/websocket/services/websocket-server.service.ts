import type { Server as HttpServer } from 'node:http';

import { WebSocket, WebSocketServer, type VerifyClientCallbackSync } from 'ws';

import { handleChatConnection } from '@/modules/websocket/services/chat-websocket.service.js';
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
};

const HEARTBEAT_INTERVAL_MS = 30_000;

export function attachWebSocketHeartbeat(ws: WebSocket, intervalMs = HEARTBEAT_INTERVAL_MS): () => void {
  let isAlive = true;
  let stopped = false;
  let heartbeat: NodeJS.Timeout;

  const markAlive = () => {
    isAlive = true;
  };

  const stopHeartbeat = () => {
    if (stopped) {
      return;
    }

    stopped = true;
    clearInterval(heartbeat);
    ws.off('pong', markAlive);
    ws.off('close', stopHeartbeat);
    ws.off('error', stopHeartbeat);
  };

  ws.on('pong', markAlive);

  heartbeat = setInterval(() => {
    if (ws.readyState !== WebSocket.OPEN) {
      return;
    }

    if (!isAlive) {
      ws.terminate();
      return;
    }

    isAlive = false;
    try {
      ws.ping();
    } catch {
      ws.terminate();
    }
  }, intervalMs);
  heartbeat.unref();

  ws.on('close', stopHeartbeat);
  ws.on('error', stopHeartbeat);

  return stopHeartbeat;
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
    ) => verifyWebSocketClient(info, dependencies.verifyClient)),
  });

  wss.on('connection', (ws, request) => {
    attachWebSocketHeartbeat(ws);

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

    console.log('[WARN] Unknown WebSocket path:', pathname);
    ws.close();
  });

  return wss;
}
