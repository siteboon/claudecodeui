/**
 * WebSocketWriter — wraps a raw `ws` WebSocket to match the SSEStreamWriter
 * interface and buffer messages across disconnect/reconnect cycles.
 *
 * Provider files produce unified NormalizedMessage events; the writer simply
 * serialises and sends. When the underlying socket is not OPEN (client
 * reloaded, transient network drop, etc.) messages queue up and are flushed
 * once `updateWebSocket()` swaps in a live socket after reconnect. Without
 * this buffer, any event emitted during the disconnect window would be
 * silently dropped (the `ws` library no-ops writes to non-OPEN sockets),
 * which is how `complete` events went missing and left the UI's send button
 * locked after a mid-turn reload.
 */

// Default cap on buffered messages between disconnect and reconnect. Picked
// to cover a long assistant turn (many stream_delta chunks + tool_use /
// tool_result) without letting a client that never comes back balloon
// memory. On overflow the OLDEST messages are dropped — the client already
// re-syncs via `check-session-status`, and losing a trailing `complete` /
// `permission_request` would be worse than losing an earlier stream_delta.
export const WS_REPLAY_BUFFER_CAP = 500;

export class WebSocketWriter {
    constructor(ws, userId = null, { bufferCap = WS_REPLAY_BUFFER_CAP, logger = console } = {}) {
        this.ws = ws;
        this.sessionId = null;
        this.userId = userId;
        this.isWebSocketWriter = true;  // Marker for transport detection
        this.bufferCap = bufferCap;
        this.logger = logger;
        // Messages queued while the socket was not OPEN; drained on the next
        // successful write (a direct `send()` on a re-OPEN socket, or an
        // `updateWebSocket()` swap after client reconnect).
        this.pending = [];
        this.pendingOverflowed = false;
    }

    send(data) {
        const serialized = JSON.stringify(data);
        if (this.ws.readyState === 1) { // WebSocket.OPEN
            // Drain any queue first so ordering is preserved across a
            // reconnect that happened mid-turn.
            if (this.pending.length > 0) this._flushPending();
            // Re-check after flush: a mid-flush failure may have flipped the
            // socket closed while survivors were re-queued. Without this
            // guard the current message would be dropped by ws.send on a
            // non-OPEN socket, even though its ordered predecessors made it
            // safely back onto `pending`.
            if (this.ws.readyState !== 1) {
                this._enqueue(serialized);
                return;
            }
            this.ws.send(serialized);
            return;
        }
        this._enqueue(serialized);
    }

    _enqueue(serialized) {
        if (this.pending.length >= this.bufferCap) {
            this.pending.shift();
            if (!this.pendingOverflowed) {
                this.pendingOverflowed = true;
                this.logger.warn?.(`[WebSocketWriter] replay buffer overflow (cap=${this.bufferCap}) for session ${this.sessionId || 'NEW'} — dropping oldest messages`);
            }
        }
        this.pending.push(serialized);
    }

    _flushPending() {
        if (this.ws.readyState !== 1) return;
        const queue = this.pending;
        this.pending = [];
        this.pendingOverflowed = false;
        // Stop-on-first-failure: if the socket flips closed or a single
        // `ws.send` throws partway through the queue, requeue the failed
        // item and every item after it, preserving their original order.
        // Continuing past a failure would ship later items out-of-order
        // relative to the re-queued one (e.g. wire order
        // `tool_use → tool_result` becomes `tool_result → tool_use`).
        for (let i = 0; i < queue.length; i++) {
            const msg = queue[i];
            if (this.ws.readyState !== 1) {
                for (let j = i; j < queue.length; j++) this.pending.push(queue[j]);
                return;
            }
            try {
                this.ws.send(msg);
            } catch (err) {
                this.logger.warn?.(`[WebSocketWriter] flush send failed for session ${this.sessionId || 'NEW'}:`, err?.message || err);
                for (let j = i; j < queue.length; j++) this.pending.push(queue[j]);
                return;
            }
        }
    }

    updateWebSocket(newRawWs) {
        this.ws = newRawWs;
        if (this.pending.length === 0) return;
        if (newRawWs.readyState === 1) {
            this._flushPending();
        } else {
            // The `ws` server emits 'open' synchronously before upgrade
            // returns, so in practice the new socket is already OPEN here.
            // Keep a listener as a safety net for future transport changes
            // (e.g. custom pre-OPEN sockets).
            newRawWs.once?.('open', () => this._flushPending());
        }
    }

    setSessionId(sessionId) {
        this.sessionId = sessionId;
    }

    getSessionId() {
        return this.sessionId;
    }
}
