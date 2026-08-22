/**
 * Browser/server clock reconciliation for chat rows.
 *
 * The chat pane renders one chronologically sorted list built from two
 * different clocks: persisted transcript rows stamped by the machine running
 * the provider CLI, and optimistic/streaming rows stamped by the browser.
 *
 * A browser clock running ahead of the server makes an optimistic user row
 * look *newer* than the persisted copy the CLI just wrote. Reconciliation
 * (`removeOptimisticUserEchoes`) then refuses the match, so the local echo
 * survives as a second user bubble and — being stamped in the future — sorts
 * after the agent's reply. Reloading drops realtime rows, which is why the
 * duplicate disappears on refresh.
 *
 * Every API response already carries the server's `Date` header, so the
 * offset is free to measure. Client-side rows are stamped through here and
 * land on the same timeline as the transcript.
 */

// HTTP `Date` is second-granular and every sample carries request latency, so
// a small offset is measurement noise rather than a clock that disagrees.
const MIN_SIGNIFICANT_OFFSET_MS = 2_000;

// The midpoint estimate is only as good as the round trip is symmetric, so a
// slow request can be wrong by half its duration. Discarding samples above
// this keeps that error below the reconciler's own skew tolerance.
const MAX_SAMPLE_ROUND_TRIP_MS = 10_000;

let serverClockOffsetMs = 0;

/**
 * Records one offset sample from a response's `Date` header. The server
 * generated that header somewhere between the request leaving and the response
 * arriving, so the request midpoint is the closest client-side instant.
 */
export function recordServerClockSample(
  dateHeader: string | null | undefined,
  sentAt: number,
  receivedAt: number,
): void {
  if (!dateHeader) return;
  if (receivedAt - sentAt > MAX_SAMPLE_ROUND_TRIP_MS) return;

  const serverTime = Date.parse(dateHeader);
  if (!Number.isFinite(serverTime)) return;

  const clientTime = sentAt + (receivedAt - sentAt) / 2;
  const offset = serverTime - clientTime;
  serverClockOffsetMs = Math.abs(offset) < MIN_SIGNIFICANT_OFFSET_MS ? 0 : offset;
}

/** Signed correction to add to a browser timestamp to get server time. */
export function getServerClockOffsetMs(): number {
  return serverClockOffsetMs;
}

/** Converts a browser-clock instant to the server's timeline. */
export function toServerTime(clientTime: Date | number): number {
  const time = clientTime instanceof Date ? clientTime.getTime() : clientTime;
  return time + serverClockOffsetMs;
}

/** Server-clock ISO stamp for a row created in the browser right now. */
export function serverNowIso(): string {
  return new Date(Date.now() + serverClockOffsetMs).toISOString();
}

/** Server-clock ISO stamp for a row created at a known browser instant. */
export function toServerIso(clientTime: Date | number): string {
  return new Date(toServerTime(clientTime)).toISOString();
}

/** Test seam — resets the measured offset. */
export function resetServerClockOffsetForTests(): void {
  serverClockOffsetMs = 0;
}
