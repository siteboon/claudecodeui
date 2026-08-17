/**
 * Per-session buffering for live `stream_delta` frames.
 *
 * Deltas are coalesced into one store write per flush interval, and the row
 * they write to is closed at every assistant-message boundary. Both concerns
 * live here, free of React, so they can be tested directly.
 */

/** One session's open streaming row: the deltas so far plus its pending flush. */
type StreamBuffer = {
  text: string;
  /** What the row already holds, so closing does not repeat the last write. */
  flushedText: string;
  timer: number | null;
};

/** Open streaming rows, keyed by app session id. */
export type StreamBuffers = Map<string, StreamBuffer>;

/**
 * Store writes a buffer needs. `finalize` must re-id the row away from the
 * well-known streaming id, otherwise the next message's first delta replaces
 * the row this one just closed.
 */
export type StreamRowSink = {
  update: (sessionId: string, text: string) => void;
  finalize: (sessionId: string) => void;
};

/** Timer plumbing, injected so tests can drive flushes deterministically. */
export type StreamFlushScheduler = {
  schedule: (flush: () => void) => number;
  cancel: (timer: number) => void;
};

/** Coalescing window for delta writes. Long enough to spare React a render per token. */
const STREAM_FLUSH_INTERVAL_MS = 100;

const STREAM_BOUNDARY_KINDS = new Set(['text', 'thinking', 'tool_use', 'tool_result']);

/**
 * Whether a frame ends the assistant message currently being streamed.
 *
 * Providers are not required to emit `stream_end` per message — Cursor never
 * emits it, and OpenCode only emits it at `step_finish` — so the boundary is
 * derived from the frame kinds that carry a row of their own instead.
 */
export function isStreamBoundaryKind(kind: string | undefined): boolean {
  return typeof kind === 'string' && STREAM_BOUNDARY_KINDS.has(kind);
}

/**
 * Accumulate one delta and make sure a flush is pending for its session.
 */
export function appendStreamDelta(
  buffers: StreamBuffers,
  sessionId: string,
  text: string,
  sink: StreamRowSink,
  scheduler: StreamFlushScheduler,
): void {
  const buffer = buffers.get(sessionId) ?? { text: '', flushedText: '', timer: null };
  buffer.text += text;
  buffers.set(sessionId, buffer);

  if (buffer.timer !== null) {
    return;
  }

  buffer.timer = scheduler.schedule(() => {
    // The buffer can be closed or dropped between scheduling and firing.
    const pending = buffers.get(sessionId);
    if (pending !== buffer) {
      return;
    }
    pending.timer = null;
    pending.flushedText = pending.text;
    sink.update(sessionId, pending.text);
  });
}

/**
 * Close one session's streamed row: flush every delta into it, then finalize it
 * so the next assistant message starts a row of its own.
 *
 * `finalize` runs even with no buffer open, because a row can outlive its
 * buffer — switching away from a streaming session drops the buffer and leaves
 * the row parked at the well-known id. Finalizing frees that id; the store call
 * is a no-op when no such row exists.
 */
export function closeStreamBuffer(
  buffers: StreamBuffers,
  sessionId: string,
  sink: StreamRowSink,
  scheduler: StreamFlushScheduler,
): void {
  const buffer = buffers.get(sessionId);

  if (buffer) {
    if (buffer.timer !== null) {
      scheduler.cancel(buffer.timer);
    }
    buffers.delete(sessionId);

    if (buffer.text && buffer.text !== buffer.flushedText) {
      sink.update(sessionId, buffer.text);
    }
  }

  sink.finalize(sessionId);
}

/**
 * Abandon buffers without writing them to the store: one session's when the
 * view moves off it, or every session's when the chat unmounts. Passing a
 * session id leaves other sessions' pending flushes alone.
 */
export function dropStreamBuffers(
  buffers: StreamBuffers,
  scheduler: StreamFlushScheduler,
  sessionId?: string,
): void {
  const doomed = sessionId === undefined
    ? [...buffers.keys()]
    : [sessionId];

  for (const id of doomed) {
    const buffer = buffers.get(id);
    if (!buffer) {
      continue;
    }
    if (buffer.timer !== null) {
      scheduler.cancel(buffer.timer);
    }
    buffers.delete(id);
  }
}

/** Scheduler backed by the browser timer queue. */
export const windowStreamFlushScheduler: StreamFlushScheduler = {
  schedule: (flush) => window.setTimeout(flush, STREAM_FLUSH_INTERVAL_MS),
  cancel: (timer) => clearTimeout(timer),
};
