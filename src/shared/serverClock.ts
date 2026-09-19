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
 * The same skew also reaches `computeMerged`'s sort and
 * `getUserTurnOrdinalBefore`, so the correction is applied once, where the
 * row is created, rather than guarded separately in each consumer.
 *
 * The measurement is free: the `chat_subscribed` ack already carries the
 * server's own timestamp, and the client already records when it sent the
 * subscribe that the ack answers. No request, header or round trip is added.
 */

/**
 * The midpoint estimate is only as good as the round trip is symmetric, so a
 * slow ack can be wrong by half its duration. Discarding samples above this
 * keeps that error below the reconciler's own skew tolerance.
 */
const MAX_SAMPLE_ROUND_TRIP_MS = 10_000;

/**
 * A server whose clock is out by more than a day is broken, not skewed.
 * Adopting such a reading would push every locally created row far outside
 * the reconciler's 5-minute dedupe window, turning an intermittent duplicate
 * bubble into a permanent one — so the sample is dropped and the last good
 * offset kept.
 */
const MAX_PLAUSIBLE_OFFSET_MS = 24 * 60 * 60 * 1000;

/**
 * Samples kept to pick from. Last-sample-wins makes the offset track network
 * noise; keeping a few and using the least-delayed one makes it track the
 * clock. Small because a reconnect storm should not pin a stale reading.
 */
const SAMPLE_WINDOW_SIZE = 5;

type ClockSample = {
  offsetMs: number;
  roundTripMs: number;
};

let samples: ClockSample[] = [];
let serverClockOffsetMs = 0;
let lastIssuedServerTime: number | null = null;

/**
 * Records one offset sample from a server frame that carries the instant the
 * server sent it. The server produced that instant somewhere between the
 * request leaving and the reply arriving, so the round-trip midpoint is the
 * closest client-side instant, and the estimate's error is bounded by half
 * the round trip.
 *
 * @param serverInstant ISO string or epoch ms taken from the server frame.
 * @param sentAt Browser `Date.now()` when the request this answers was sent.
 * @param receivedAt Browser `Date.now()` when the frame arrived.
 */
export function recordServerClockSample(
  serverInstant: string | number | null | undefined,
  sentAt: number | null | undefined,
  receivedAt: number,
): void {
  if (serverInstant === null || serverInstant === undefined || serverInstant === '') return;
  if (!Number.isFinite(sentAt) || !Number.isFinite(receivedAt)) return;

  const roundTripMs = receivedAt - (sentAt as number);
  if (roundTripMs < 0 || roundTripMs > MAX_SAMPLE_ROUND_TRIP_MS) return;

  const serverTime = typeof serverInstant === 'number' ? serverInstant : Date.parse(serverInstant);
  if (!Number.isFinite(serverTime)) return;

  const clientTime = (sentAt as number) + roundTripMs / 2;
  const offsetMs = serverTime - clientTime;
  if (Math.abs(offsetMs) > MAX_PLAUSIBLE_OFFSET_MS) return;

  samples = [...samples, { offsetMs, roundTripMs }].slice(-SAMPLE_WINDOW_SIZE);
  serverClockOffsetMs = samples.reduce(
    (best, sample) => (sample.roundTripMs < best.roundTripMs ? sample : best),
  ).offsetMs;
}

/** Signed correction to add to a browser timestamp to get server time. */
export function getServerClockOffsetMs(): number {
  return serverClockOffsetMs;
}

/**
 * Converts a browser-clock instant to the server's timeline.
 *
 * Never returns an instant earlier than one it already returned. A new sample
 * can move the offset backwards, and without the floor two rows created a
 * second apart could be stamped out of order and render out of order. Both
 * callers below only ever stamp rows at the moment they are created, so
 * clamping to the last issued instant is always the correct reading.
 */
export function toServerTime(clientTime: Date | number): number {
  const time = clientTime instanceof Date ? clientTime.getTime() : clientTime;
  const corrected = time + serverClockOffsetMs;
  const issued = lastIssuedServerTime === null ? corrected : Math.max(corrected, lastIssuedServerTime);
  lastIssuedServerTime = issued;
  return issued;
}

/** Server-clock ISO stamp for a row created in the browser right now. */
export function serverNowIso(): string {
  return new Date(toServerTime(Date.now())).toISOString();
}

/** Server-clock ISO stamp for a row created at a known browser instant. */
export function toServerIso(clientTime: Date | number): string {
  return new Date(toServerTime(clientTime)).toISOString();
}

/** Test seam — resets the measured offset and the monotonic floor. */
export function resetServerClockOffsetForTests(): void {
  samples = [];
  serverClockOffsetMs = 0;
  lastIssuedServerTime = null;
}
