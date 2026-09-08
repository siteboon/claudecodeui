import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveRunEndOutcome } from '@/modules/providers/list/claude/claude-runtime.provider.js';

// A run that never reported success records the failure as the failure it is.
test('claude run lifecycle: a plain failure ends as error/1', () => {
  const out = resolveRunEndOutcome({
    turnCompleteSent: false,
    error: new Error('spawn ENOENT'),
  });

  assert.equal(out.reason, 'error');
  assert.equal(out.exitCode, 1);
  assert.equal(out.error, 'spawn ENOENT');
  assert.equal(out.lateError, undefined);
});

// The counter-direction, and the reason this function exists: the client was
// already told the turn completed with exit code 0. Recording error/1 here
// would leave one run with two terminal outcomes that contradict each other.
test('claude run lifecycle: a failure after the terminal complete keeps the completed outcome', () => {
  const out = resolveRunEndOutcome({
    turnCompleteSent: true,
    error: new Error('stream closed during post-turn hold'),
  });

  assert.equal(out.reason, 'completed');
  assert.equal(out.exitCode, 0);
  assert.equal(out.lateError, 'stream closed during post-turn hold');
  // The completed outcome must not carry an `error` field -- that is the field
  // a reader takes as "this run failed".
  assert.equal(out.error, undefined);
});

// The late failure is preserved, not swallowed. A rule that quietly dropped the
// error would trade one wrong record for a missing one.
test('claude run lifecycle: the late failure is still recorded', () => {
  const out = resolveRunEndOutcome({ turnCompleteSent: true, error: new Error('boom') });

  assert.ok(Object.values(out).includes('boom'));
});

// Not everything thrown is an Error.
test('claude run lifecycle: a non-Error throw is still described', () => {
  assert.equal(resolveRunEndOutcome({ turnCompleteSent: false, error: 'plain string' }).error, 'plain string');
  assert.equal(resolveRunEndOutcome({ turnCompleteSent: false, error: null }).error, 'null');
});

// A truthy, non-string `message` (BigInt is the concrete case CodeRabbit
// found) used to reach JSON.stringify() in logRunLifecycle() unconverted --
// `error?.message || String(error)` only stringifies on the FALSY branch.
// JSON.stringify() cannot serialise a BigInt, and by the point this throws,
// logRunEnd() has already marked the run as logged, so no fallback re-emits
// it: one run, no terminal record at all.
test('claude run lifecycle: a BigInt message is stringified, not passed through', () => {
  const out = resolveRunEndOutcome({
    turnCompleteSent: false,
    error: { message: 1n },
  });

  assert.equal(out.error, '1');
  assert.doesNotThrow(() => JSON.stringify(out));
});

// The counter-case for the same fix: a falsy-but-meaningful message (empty
// string, zero) must not be discarded in favour of `String(error)` the way
// `||` would. `??` only falls back on null/undefined.
test('claude run lifecycle: a falsy-but-defined message is kept, not replaced', () => {
  assert.equal(resolveRunEndOutcome({ turnCompleteSent: false, error: { message: '' } }).error, '');
  assert.equal(resolveRunEndOutcome({ turnCompleteSent: false, error: { message: 0 } }).error, '0');
});

// Defence in depth: even a value whose own stringification throws (a
// deliberately hostile `toString()`, e.g. from a Proxy) must not take down
// the terminal record with it.
test('claude run lifecycle: an unstringifiable error falls back instead of throwing', () => {
  const hostile = { message: { toString() { throw new Error('nope'); } } };

  const out = resolveRunEndOutcome({ turnCompleteSent: false, error: hostile });

  assert.equal(out.error, 'Unserializable error');
  assert.doesNotThrow(() => JSON.stringify(out));
});
