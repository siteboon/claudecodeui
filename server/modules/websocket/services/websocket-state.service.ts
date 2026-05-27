import type { RealtimeClientConnection } from '@/shared/types.js';

/**
 * Numeric readyState for an open WebSocket connection.
 *
 * We keep this in module state so services that broadcast updates do not need
 * to import `ws` directly just to compare open/closed state.
 */
export const WS_OPEN_STATE = 1;

/**
 * Shared registry of active chat WebSocket connections.
 *
 * Project/session services publish realtime updates by iterating this set.
 */
export const connectedClients = new Set<RealtimeClientConnection>();

/**
 * Per-session subscriber registry for multi-window broadcast.
 *
 * When a second window opens the same active session it registers here via
 * registerSessionConnection().  WebSocketWriter.send() then broadcasts every
 * outgoing message to all subscribers for that session so every open window
 * receives live streaming events, not just the one that initiated the command.
 */
const sessionConnections = new Map<string, Set<RealtimeClientConnection>>();

export function registerSessionConnection(sessionId: string, ws: RealtimeClientConnection): void {
  let clients = sessionConnections.get(sessionId);
  if (!clients) {
    clients = new Set();
    sessionConnections.set(sessionId, clients);
  }
  clients.add(ws);
}

export function unregisterFromAllSessions(ws: RealtimeClientConnection): void {
  for (const clients of sessionConnections.values()) {
    clients.delete(ws);
  }
}

/**
 * Send pre-serialized JSON to all subscriber connections for a session,
 * optionally skipping the primary writer socket to avoid duplicate delivery.
 */
export function broadcastToSessionSubscribers(
  sessionId: string,
  serializedData: string,
  excludeWs?: RealtimeClientConnection
): void {
  const clients = sessionConnections.get(sessionId);
  if (!clients) return;
  for (const ws of clients) {
    if (ws !== excludeWs && ws.readyState === WS_OPEN_STATE) {
      ws.send(serializedData);
    }
  }
}
