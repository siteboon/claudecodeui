import { WS_OPEN_STATE } from '@/modules/websocket/services/websocket-state.service.js';
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
  preferredAccountId: string | null;

  constructor(ws: RealtimeClientConnection, userId: string | number | null = null) {
    this.ws = ws;
    this.sessionId = null;
    this.userId = userId;
    this.isWebSocketWriter = true;
    this.preferredAccountId = null;
  }

  send(data: unknown): void {
    if (this.ws.readyState === WS_OPEN_STATE) {
      this.ws.send(JSON.stringify(data));
    }
  }

  updateWebSocket(newRawWs: RealtimeClientConnection): void {
    this.ws = newRawWs;
  }

  setSessionId(sessionId: string): void {
    this.sessionId = sessionId;
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  setPreferredAccountId(accountId: string | null): void {
    if (typeof accountId === 'string' && accountId.trim().length > 0) {
      this.preferredAccountId = accountId.trim();
    } else {
      this.preferredAccountId = null;
    }
  }

  getPreferredAccountId(): string | null {
    return this.preferredAccountId;
  }
}
