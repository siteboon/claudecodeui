import assert from 'node:assert/strict';
import test from 'node:test';

import {
  describeBackgroundTasks,
  formatWaitDuration,
  shouldAnnounceBackgroundTasks,
  shouldHoldForBackgroundWork,
} from '@/modules/providers/list/claude/claude-runtime.provider.js';

/**
 * The sentences these build are what a reader sees, and they are all a client
 * that knows nothing of `backgroundWait` ever gets — so they are asserted here
 * rather than left to the renderer.
 */
test('a task list reads as a count, and names the work when it can', () => {
  assert.equal(describeBackgroundTasks([{ description: 'deploy watch' }]), '1 background task (deploy watch)');
  assert.equal(
    describeBackgroundTasks([{ description: 'deploy watch' }, { description: 'log tail' }]),
    '2 background tasks (deploy watch, log tail)',
  );
});

test('work the CLI does not describe still reports how much of it there is', () => {
  assert.equal(describeBackgroundTasks([{}, {}]), '2 background tasks');
  assert.equal(describeBackgroundTasks([{ description: '   ' }]), '1 background task');
});

test('a duration reads the way the CLI writes one', () => {
  assert.equal(formatWaitDuration(0), '0s');
  assert.equal(formatWaitDuration(45_000), '45s');
  assert.equal(formatWaitDuration(142_000), '2m 22s');
  assert.equal(formatWaitDuration(1_800_000), '30m 0s');
  assert.equal(formatWaitDuration(-5), '0s');
});

test('the hold stands for work this turn armed, and for work the CLI still lists', () => {
  // What this turn armed, as before.
  assert.equal(shouldHoldForBackgroundWork(true, []), true);
  // What an earlier turn armed and the CLI still lists: a turn resumed mid-wait
  // used to release the process under it, and the follow-up turn went missing.
  assert.equal(shouldHoldForBackgroundWork(false, [{ id: 't1' }]), true);
  // Nothing outstanding: the process exits at once, as it always has.
  assert.equal(shouldHoldForBackgroundWork(false, []), false);
});

test('any change to a non-empty task list is worth a row, not only a longer one', () => {
  const one = [{ id: 't1' }];
  const two = [{ id: 't1' }, { id: 't2' }];

  // work armed
  assert.equal(shouldAnnounceBackgroundTasks([], one), true);
  assert.equal(shouldAnnounceBackgroundTasks(one, two), true);
  // one of two finished: the row said "2 background tasks" and no longer should
  assert.equal(shouldAnnounceBackgroundTasks(two, one), true);
  // the same work, re-sent: nothing new to say
  assert.equal(shouldAnnounceBackgroundTasks(one, [{ id: 't1' }]), false);
  // one swapped for another, same count
  assert.equal(shouldAnnounceBackgroundTasks(one, [{ id: 't9' }]), true);
  // the list emptying is the end of the wait, reported on its own
  assert.equal(shouldAnnounceBackgroundTasks(two, []), false);
});
