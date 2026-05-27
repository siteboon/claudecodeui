import type { Server as HttpServer } from 'node:http';

import { WebSocketServer, type VerifyClientCallbackSync, type WebSocket } from 'ws';

import { handleChatConnection } from '@/modules/websocket/services/chat-websocket.service.js';
import { verifyWebSocketClient } from '@/modules/websocket/services/websocket-auth.service.js';
import { handlePluginWsProxy } from '@/modules/websocket/services/plugin-websocket-proxy.service.js';
import { handleShellConnection } from '@/modules/websocket/services/shell-websocket.service.js';
import type { AuthenticatedWebSocketRequest } from '@/shared/types.js';

type WebSocketServerDependencies = {
  verifyClient: Parameters<typeof verifyWebSocketClient>[1];
  chat: Parameters<typeof handleChatConnection>[2];
  shell: Parameters<typeof handleShellConnection>[1];
  getPluginPort: Parameters<typeof handlePluginWsProxy>[2];
};

// Liveness flag attached to each socket for the heartbeat below.
type HeartbeatWebSocket = WebSocket & { isAlive?: boolean };

// Interval between server-initiated ping frames. Must be shorter than the
// idle timeout of any proxy in front of us (NGINX Proxy Manager defaults to
// 60s, Cloudflare ~100s) so idle WebSocket connections aren't dropped. A
// dropped connection mid-session is the likely cause of "disappearing"
// prompts and lost sessions.
const HEARTBEAT_INTERVAL_MS = 30000;

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
    // Heartbeat: mark alive on connect and whenever the client answers a ping
    // with a pong. The browser's WebSocket layer auto-replies to ping frames,
    // so this works even while the app is busy streaming a long response.
    const socket = ws as HeartbeatWebSocket;
    socket.isAlive = true;
    socket.on('pong', () => { socket.isAlive = true; });

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

    if (pathname.startsWith('/plugin-ws/')) {
      handlePluginWsProxy(ws, pathname, dependencies.getPluginPort);
      return;
    }

    console.log('[WARN] Unknown WebSocket path:', pathname);
    ws.close();
  });

  // Periodically ping every client. A client that missed the previous ping
  // (no pong received) is considered dead and terminated; everyone else gets
  // a fresh ping that keeps the connection non-idle through any proxy.
  const heartbeat = setInterval(() => {
    for (const client of wss.clients) {
      const socket = client as HeartbeatWebSocket;
      if (socket.isAlive === false) {
        socket.terminate();
        continue;
      }
      socket.isAlive = false;
      socket.ping();
    }
  }, HEARTBEAT_INTERVAL_MS);

  wss.on('close', () => clearInterval(heartbeat));

  return wss;
}
