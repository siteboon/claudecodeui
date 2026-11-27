import assert from 'node:assert/strict';

import { beforeEach, test } from 'vitest';

import { removeOptimisticUserEchoes } from '@/modules/chat/utils/sessionMessageReconciliation';
import type { NormalizedMessage } from '@/shared/types';

import {
  getServerClockOffsetMs,
  recordServerClockSample,
  resetServerClockOffsetForTests,
  serverNowIso,
  toServerIso,
} from '@/shared/serverClock';

/**
 * The offset estimator behind #1195, plus the end-to-end case that pins the
 * bug itself: a browser clock running ahead of the server leaves a second
 * user bubble because reconciliation refuses the match.
 */

const SERVER_NOW = Date.parse('2026-08-21T12:00:00.000Z');
const ACK_LATENCY_MS = 120;

/** One `chat_subscribed` ack, observed by a browser clock `skewMs` off. */
const sampleWithSkew = (
  skewMs: number,
  { serverTime = SERVER_NOW, roundTripMs = ACK_LATENCY_MS } = {},
): void => {
  const sentAt = serverTime + skewMs;
  recordServerClockSample(new Date(serverTime).toISOString(), sentAt, sentAt + roundTripMs);
};

const userRow = (id: string, timestamp: string, content: string): NormalizedMessage => ({
  id,
  sessionId: 'session-1',
  timestamp,
  provider: 'claude',
  kind: 'text',
  role: 'user',
  content,
} as NormalizedMessage);

beforeEach(() => {
  resetServerClockOffsetForTests();
});

test('keeps a sub-second offset instead of snapping it to zero', () => {
  sampleWithSkew(400);

  // An earlier revision zeroed anything under two seconds. Last-sample-wins
  // plus a snap-to-zero makes a real offset near the threshold flip on and
  // off, and two rows stamped either side of a flip render out of order.
  const offset = getServerClockOffsetMs();
  assert.ok(offset < -300 && offset > -500, `unexpected offset ${offset}`);
});

test('measures a browser clock running ahead of the server', () => {
  sampleWithSkew(45_000);

  // Negative: browser timestamps must be pulled back onto server time.
  const offset = getServerClockOffsetMs();
  assert.ok(offset < -44_000 && offset > -46_000, `unexpected offset ${offset}`);
  assert.equal(toServerIso(SERVER_NOW + 45_000), '2026-08-21T11:59:59.940Z');
});

test('measures a browser clock running behind the server', () => {
  sampleWithSkew(-90_000);

  const offset = getServerClockOffsetMs();
  assert.ok(offset > 89_000 && offset < 91_000, `unexpected offset ${offset}`);
});

test('a fast browser clock no longer leaves a duplicate user bubble', () => {
  // Browser 45s ahead: an uncorrected optimistic row reads as newer than the
  // transcript copy, which is more than the reconciler's skew allowance.
  sampleWithSkew(45_000);

  const submittedAtOnBrowser = SERVER_NOW + 45_000;
  const persistedUserTurn = userRow(
    'claude_user',
    new Date(SERVER_NOW + 800).toISOString(),
    'привет',
  );

  const uncorrected = userRow(
    'local_uncorrected',
    new Date(submittedAtOnBrowser).toISOString(),
    'привет',
  );
  assert.deepEqual(
    removeOptimisticUserEchoes([persistedUserTurn], [uncorrected]),
    [uncorrected],
    'browser-stamped echo is what produced the duplicate bubble',
  );

  const corrected = userRow('local_corrected', toServerIso(submittedAtOnBrowser), 'привет');
  assert.deepEqual(
    removeOptimisticUserEchoes([persistedUserTurn], [corrected]),
    [],
    'server-stamped echo reconciles with the persisted turn',
  );
});

test('serverNowIso stays on the server timeline', () => {
  sampleWithSkew(45_000);

  const stamped = Date.parse(serverNowIso());
  assert.ok(
    Math.abs(stamped - (Date.now() + getServerClockOffsetMs())) < 1_000,
    'stamp should follow the measured offset',
  );
});

test('no server timestamp leaves the offset untouched', () => {
  recordServerClockSample(null, SERVER_NOW, SERVER_NOW + ACK_LATENCY_MS);
  recordServerClockSample(undefined, SERVER_NOW, SERVER_NOW + ACK_LATENCY_MS);
  recordServerClockSample('not a date', SERVER_NOW, SERVER_NOW + ACK_LATENCY_MS);
  assert.equal(getServerClockOffsetMs(), 0);
});

test('an ack with no recorded send instant is not a sample', () => {
  // `statusCheckSentAtRef` has no entry for the session, so there is no `t0`
  // and the midpoint cannot be computed. The ack must be ignored, not guessed.
  recordServerClockSample(new Date(SERVER_NOW).toISOString(), undefined, SERVER_NOW + 45_000);
  assert.equal(getServerClockOffsetMs(), 0);
});

test('discards a sample whose round trip is too slow to trust', () => {
  // Half of a 30s round trip is more error than the reconciler tolerates, so
  // the sample says nothing useful about where the server clock sits.
  sampleWithSkew(45_000, { roundTripMs: 30_000 });
  assert.equal(getServerClockOffsetMs(), 0);
});

test('accepts both the ISO string and an epoch-millisecond instant', () => {
  const sentAt = SERVER_NOW + 45_000;
  recordServerClockSample(new Date(SERVER_NOW).toISOString(), sentAt, sentAt + ACK_LATENCY_MS);
  assert.equal(toServerIso(SERVER_NOW + 45_000), '2026-08-21T11:59:59.940Z');

  resetServerClockOffsetForTests();
  recordServerClockSample(SERVER_NOW, sentAt, sentAt + ACK_LATENCY_MS);
  assert.equal(toServerIso(SERVER_NOW + 45_000), '2026-08-21T11:59:59.940Z');
});

test('rejects an implausible offset and keeps the last good one', () => {
  sampleWithSkew(45_000);
  const measured = getServerClockOffsetMs();

  // A server whose clock is three days out is broken, not skewed. Adopting it
  // would push every local row outside the reconciler's 5-minute window and
  // make the duplicate bubble permanent instead of intermittent.
  sampleWithSkew(45_000, { serverTime: SERVER_NOW + 3 * 24 * 60 * 60 * 1000 });
  assert.equal(getServerClockOffsetMs(), measured);
});

test('prefers the lowest-round-trip sample over the most recent one', () => {
  sampleWithSkew(45_000, { roundTripMs: 40 });
  const clean = getServerClockOffsetMs();

  // A later sample delayed by 8s can be wrong by up to 4s. The clean reading
  // is still the better estimate of the same clock.
  sampleWithSkew(45_000, { roundTripMs: 8_000 });
  assert.equal(getServerClockOffsetMs(), clean);
});

test('noise around the old two-second threshold no longer flips the offset', () => {
  sampleWithSkew(1_900);
  const first = getServerClockOffsetMs();
  assert.notEqual(first, 0, 'a real sub-threshold offset must be kept');

  sampleWithSkew(2_100);
  sampleWithSkew(1_950);
  assert.equal(getServerClockOffsetMs(), first, 'equal-quality noise must not move the offset');
});

test('stamps stay ordered when the offset moves backwards between two rows', () => {
  sampleWithSkew(-90_000, { roundTripMs: 40 });
  const firstStamp = Date.parse(toServerIso(SERVER_NOW));

  // A cleaner sample of a server whose clock has since been corrected drops
  // the offset by a minute. Without the monotonic floor the next row, created
  // a second later, would be stamped *before* the first one and render above
  // it.
  recordServerClockSample(
    new Date(SERVER_NOW - 60_000).toISOString(),
    SERVER_NOW - 90_000,
    SERVER_NOW - 90_000 + 20,
  );
  assert.ok(
    getServerClockOffsetMs() < 40_000,
    'the cleaner sample should have moved the offset backwards',
  );

  const secondStamp = Date.parse(toServerIso(SERVER_NOW + 1_000));
  assert.ok(secondStamp >= firstStamp, `expected ${secondStamp} >= ${firstStamp}`);
});
