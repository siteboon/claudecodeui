import { broadcastToSessionSubscribers, registerSessionConnection, WS_OPEN_STATE } from '@/modules/websocket/services/websocket-state.service.js';
import type { RealtimeClientConnection } from '@/shared/types.js';

/**
 * Thin transport adapter that gives WebSocket connections the same interface as
 * SSE writers used by API routes (`send`, `setSessionId`, `getSessionId`).
 */
export class WebSocketWriter {
  ws: RealtimeClientConnection;
  sessionId: string | null;
  userId: string | number | null;
  isWebSocketWriter: boolean;

  constructor(ws: RealtimeClientConnection, userId: string | number | null = null) {
    this.ws = ws;
    this.sessionId = null;
    this.userId = userId;
    this.isWebSocketWriter = true;
  }

  send(data: unknown): void {
    const serialized = JSON.stringify(data);
    if (this.ws.readyState === WS_OPEN_STATE) {
      this.ws.send(serialized);
    }
    // Broadcast to every other window that opened the same session
    if (this.sessionId) {
      broadcastToSessionSubscribers(this.sessionId, serialized, this.ws);
    }
  }

  updateWebSocket(newRawWs: RealtimeClientConnection): void {
    this.ws = newRawWs;
  }

  setSessionId(sessionId: string): void {
    this.sessionId = sessionId;
    // Auto-register this window as a subscriber so it also receives broadcasts
    // from future turns initiated by other windows on the same session.
    registerSessionConnection(sessionId, this.ws);
  }

  getSessionId(): string | null {
    return this.sessionId;
  }
}
