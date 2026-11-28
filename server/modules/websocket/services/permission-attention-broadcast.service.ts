import { broadcastToConnectedClients } from '@/modules/websocket/services/websocket-state.service.js';
import type { NormalizedMessage } from '@/shared/types.js';

/**
 * The single producer of the `permission_attention` / `permission_attention_cleared`
 * deltas.
 *
 * A provider's permission request only ever reached the sockets subscribed to
 * that run, so a question raised in a session the user was not looking at was
 * invisible: no sidebar marker, no sound, no title hint. Nothing told the user
 * that a turn was now waiting on them.
 *
 * These two events carry just enough to mark a sidebar row (session id,
 * request id, tool name) and are broadcast to every connected client. The
 * request's own payload — its input and context — stays on the run stream, so
 * the announcement never widens what a non-subscribed client can see.
 */

type PermissionAttentionEvent = {
  kind: 'permission_attention';
  sessionId: string;
  requestId: string;
  toolName: string | null;
  timestamp: string;
};

type PermissionAttentionClearedEvent = {
  kind: 'permission_attention_cleared';
  sessionId: string;
  requestId: string | null;
  timestamp: string;
};

/**
 * Which requests are waiting right now, kept so a client that was offline can
 * be told on reconnect. The frames above are deltas: a socket that missed one
 * would never learn about that request, or would keep a marker for a request
 * that was answered while it was away. This registry is the authoritative
 * current state those deltas describe, and it is updated before each frame is
 * broadcast, so a snapshot never lags a frame already in flight.
 */
const pendingRequests = new Map<string, Map<string, { toolName: string | null; timestamp: string }>>();

/** Events that mean "this run may now be waiting on the user". */
const RAISING_KINDS = new Set(['permission_request']);
/**
 * Events that mean the wait is over. `complete` is included because a run can
 * end (abort, crash, provider exit) with a request still unanswered; without it
 * the sidebar would keep a marker nothing can ever clear.
 */
const CLEARING_KINDS = new Set(['permission_resolved', 'permission_cancelled', 'complete']);

function readString(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function rememberRequest(sessionId: string, requestId: string, toolName: string | null): void {
  const session = pendingRequests.get(sessionId) ?? new Map();
  session.set(requestId, { toolName, timestamp: new Date().toISOString() });
  pendingRequests.set(sessionId, session);
}

/** `requestId` null means the whole session stopped waiting (the run ended). */
function forgetRequest(sessionId: string, requestId: string | null): void {
  if (!requestId) {
    pendingRequests.delete(sessionId);
    return;
  }

  const session = pendingRequests.get(sessionId);
  if (!session) {
    return;
  }
  session.delete(requestId);
  if (session.size === 0) {
    pendingRequests.delete(sessionId);
  }
}

/**
 * The current waiting set as one frame, for a client that just (re)connected.
 * The client replaces its state with this, so requests answered while it was
 * offline stop showing and requests raised meanwhile start showing.
 */
export function permissionAttentionSnapshot(): string {
  const sessions: Array<{
    sessionId: string;
    requestId: string;
    toolName: string | null;
    timestamp: string;
  }> = [];

  for (const [sessionId, requests] of pendingRequests) {
    for (const [requestId, request] of requests) {
      sessions.push({ sessionId, requestId, toolName: request.toolName, timestamp: request.timestamp });
    }
  }

  return JSON.stringify({ kind: 'permission_attention_snapshot', sessions });
}

/**
 * Announces one outbound run event if it changes whether a session is waiting
 * on the user. Called by the chat session writer with the already-decorated
 * event, so `sessionId` is always the app session id the sidebar keys on.
 */
export function broadcastPermissionAttention(message: NormalizedMessage): void {
  const sessionId = readString(message.sessionId);
  if (!sessionId) {
    return;
  }

  const kind = message.kind;

  if (RAISING_KINDS.has(kind)) {
    const requestId = readString(message.requestId);
    if (!requestId) {
      return;
    }

    const toolName = readString(message.toolName);
    rememberRequest(sessionId, requestId, toolName);

    const event: PermissionAttentionEvent = {
      kind: 'permission_attention',
      sessionId,
      requestId,
      toolName,
      timestamp: new Date().toISOString(),
    };
    broadcastToConnectedClients(JSON.stringify(event));
    return;
  }

  if (CLEARING_KINDS.has(kind)) {
    const requestId = readString(message.requestId);
    forgetRequest(sessionId, requestId);

    const event: PermissionAttentionClearedEvent = {
      kind: 'permission_attention_cleared',
      sessionId,
      requestId,
      timestamp: new Date().toISOString(),
    };
    broadcastToConnectedClients(JSON.stringify(event));
  }
}
