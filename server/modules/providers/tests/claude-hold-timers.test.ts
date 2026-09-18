import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import { createHoldTimers } from '@/modules/providers/list/claude/claude-runtime.provider.js';

/**
 * A held run is bounded by two timers with different questions. The idle one
 * asks "has anything happened lately?" and is pushed back by every frame; the
 * total one asks "how long has this been held?" and is never pushed back.
 * Before this pair existed there was only the idle timer, which meant a job
 * that kept talking held its process open with no upper bound at all.
 */

const setup = (t: TestContext, idleMs: number, totalMs: number) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const released: string[] = [];
  const timers = createHoldTimers({ onRelease: (reason: string) => released.push(reason), idleMs, totalMs });
  return { timers, released };
};

test('the idle timer releases when nothing arrives', (t) => {
  const { timers, released } = setup(t, 1000, 10_000);
  timers.schedule();

  t.mock.timers.tick(999);
  assert.equal(released.length, 0);
  t.mock.timers.tick(2);
  assert.equal(released.length, 1);
});

test('activity pushes the idle timer back', (t) => {
  const { timers, released } = setup(t, 1000, 10_000);
  timers.schedule();

  for (let i = 0; i < 5; i += 1) {
    t.mock.timers.tick(900);
    timers.schedule();
  }
  // 4500ms of chatter, none of it idle for a full second.
  assert.equal(released.length, 0);

  t.mock.timers.tick(1001);
  assert.equal(released.length, 1);
});

test('the total timer is not pushed back, so a chatty job is still bounded', (t) => {
  const { timers, released } = setup(t, 1000, 5000);
  timers.schedule();

  // Keep talking forever: under the old single-timer scheme this never released.
  for (let i = 0; i < 20; i += 1) {
    t.mock.timers.tick(400);
    timers.schedule();
  }

  assert.equal(released.length, 1, 'the total ceiling must fire despite constant activity');
});

test('whichever expires first wins, and it only releases once', (t) => {
  const { timers, released } = setup(t, 1000, 5000);
  timers.schedule();

  t.mock.timers.tick(10_000);
  assert.equal(released.length, 1, 'the later timer must not release a second time');
});

test('clear disarms both, so a released hold cannot fire afterwards', (t) => {
  const { timers, released } = setup(t, 1000, 5000);
  timers.schedule();
  timers.clear();

  t.mock.timers.tick(10_000);
  assert.equal(released.length, 0);
});

test('isArmed reports whether a countdown is running', (t) => {
  const { timers } = setup(t, 1000, 5000);
  assert.equal(timers.isArmed(), false, 'nothing is armed before the first schedule');

  timers.schedule();
  assert.equal(timers.isArmed(), true);

  // A timer firing on its own must leave it disarmed, so a later frame does not
  // re-arm a hold over a stream that has already been closed.
  t.mock.timers.tick(1001);
  assert.equal(timers.isArmed(), false);
});

test('an explicit release runs the callback and disarms', (t) => {
  const { timers, released } = setup(t, 1000, 5000);
  timers.schedule();
  timers.release();

  assert.equal(released.length, 1);
  assert.equal(timers.isArmed(), false);
  t.mock.timers.tick(10_000);
  assert.equal(released.length, 1);
});

// Which limit ended a hold is the whole question when a background job turns
// out to have been cut off, so the release says which one fired.
test('a release names the limit that ended the hold', (t) => {
  const idle = setup(t, 1000, 5000);
  idle.timers.schedule();
  t.mock.timers.tick(1001);
  assert.deepEqual(idle.released, ['idle_timeout']);
});

test('the total ceiling names itself, even under constant activity', (t) => {
  const { timers, released } = setup(t, 1000, 3000);
  timers.schedule();
  for (let i = 0; i < 10; i += 1) {
    t.mock.timers.tick(400);
    timers.schedule();
  }
  assert.deepEqual(released, ['total_ceiling']);
});

test('an explicit release carries the caller\'s reason', (t) => {
  const { timers, released } = setup(t, 1000, 5000);
  timers.schedule();
  timers.release('work_reported_back');
  assert.deepEqual(released, ['work_reported_back']);
});
