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

    const event: PermissionAttentionEvent = {
      kind: 'permission_attention',
      sessionId,
      requestId,
      toolName: readString(message.toolName),
      timestamp: new Date().toISOString(),
    };
    broadcastToConnectedClients(JSON.stringify(event));
    return;
  }

  if (CLEARING_KINDS.has(kind)) {
    const event: PermissionAttentionClearedEvent = {
      kind: 'permission_attention_cleared',
      sessionId,
      requestId: readString(message.requestId),
      timestamp: new Date().toISOString(),
    };
    broadcastToConnectedClients(JSON.stringify(event));
  }
}
