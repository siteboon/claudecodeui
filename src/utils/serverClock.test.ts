import assert from 'node:assert/strict';
import test from 'node:test';

import { removeOptimisticUserEchoes } from '../stores/sessionMessageReconciliation';
import type { NormalizedMessage } from '../stores/useSessionStore';

import {
  getServerClockOffsetMs,
  recordServerClockSample,
  resetServerClockOffsetForTests,
  serverNowIso,
  toServerIso,
} from './serverClock';

const SERVER_NOW = Date.parse('2026-08-21T12:00:00.000Z');
const REQUEST_LATENCY_MS = 120;

/** One authenticated response, observed by a browser clock `skewMs` off. */
const sampleWithSkew = (skewMs: number, serverTime = SERVER_NOW): void => {
  const sentAt = serverTime + skewMs;
  recordServerClockSample(
    new Date(serverTime).toUTCString(),
    sentAt,
    sentAt + REQUEST_LATENCY_MS,
  );
};

const userRow = (
  id: string,
  timestamp: string,
  content: string,
): NormalizedMessage => ({
  id,
  sessionId: 'session-1',
  timestamp,
  provider: 'claude',
  kind: 'text',
  role: 'user',
  content,
} as NormalizedMessage);

test('ignores sub-second measurement noise as agreement', () => {
  resetServerClockOffsetForTests();
  sampleWithSkew(400);
  assert.equal(getServerClockOffsetMs(), 0);
});

test('measures a browser clock running ahead of the server', () => {
  resetServerClockOffsetForTests();
  sampleWithSkew(45_000);

  // Negative: browser timestamps must be pulled back onto server time.
  const offset = getServerClockOffsetMs();
  assert.ok(offset < -44_000 && offset > -46_000, `unexpected offset ${offset}`);
  assert.equal(toServerIso(SERVER_NOW + 45_000), '2026-08-21T11:59:59.940Z');
});

test('measures a browser clock running behind the server', () => {
  resetServerClockOffsetForTests();
  sampleWithSkew(-90_000);

  const offset = getServerClockOffsetMs();
  assert.ok(offset > 89_000 && offset < 91_000, `unexpected offset ${offset}`);
});

test('a fast browser clock no longer leaves a duplicate user bubble', () => {
  resetServerClockOffsetForTests();
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

  const corrected = userRow(
    'local_corrected',
    toServerIso(submittedAtOnBrowser),
    'привет',
  );
  assert.deepEqual(
    removeOptimisticUserEchoes([persistedUserTurn], [corrected]),
    [],
    'server-stamped echo reconciles with the persisted turn',
  );
});

test('serverNowIso stays on the server timeline', () => {
  resetServerClockOffsetForTests();
  sampleWithSkew(45_000);

  const stamped = Date.parse(serverNowIso());
  assert.ok(
    Math.abs(stamped - (Date.now() + getServerClockOffsetMs())) < 1_000,
    'stamp should follow the measured offset',
  );
});

test('no Date header leaves the offset untouched', () => {
  resetServerClockOffsetForTests();
  recordServerClockSample(null, SERVER_NOW, SERVER_NOW + REQUEST_LATENCY_MS);
  recordServerClockSample('not a date', SERVER_NOW, SERVER_NOW + REQUEST_LATENCY_MS);
  assert.equal(getServerClockOffsetMs(), 0);
});

test('discards a sample whose round trip is too slow to trust', () => {
  resetServerClockOffsetForTests();
  const sentAt = SERVER_NOW + 45_000;
  // Half of a 30s round trip is more error than the reconciler tolerates, so
  // the sample says nothing useful about where the server clock sits.
  recordServerClockSample(new Date(SERVER_NOW).toUTCString(), sentAt, sentAt + 30_000);
  assert.equal(getServerClockOffsetMs(), 0);
});

test('parses the millisecond-precision X-Server-Time format', () => {
  resetServerClockOffsetForTests();
  const sentAt = SERVER_NOW + 45_000;
  recordServerClockSample(
    new Date(SERVER_NOW).toISOString(),
    sentAt,
    sentAt + REQUEST_LATENCY_MS,
  );
  assert.equal(toServerIso(SERVER_NOW + 45_000), '2026-08-21T11:59:59.940Z');
});
