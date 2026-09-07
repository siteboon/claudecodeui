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
