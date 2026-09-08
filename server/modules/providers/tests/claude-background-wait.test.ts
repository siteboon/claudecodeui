import assert from 'node:assert/strict';
import test from 'node:test';

import {
  describeBackgroundTasks,
  formatWaitDuration,
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
