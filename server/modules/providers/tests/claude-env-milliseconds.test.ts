import assert from 'node:assert/strict';
import test from 'node:test';

import { readMillisecondsEnv } from '@/modules/providers/list/claude/claude-runtime.provider.js';

/**
 * Millisecond settings read from the environment keep an explicit 0 and never
 * exceed the longest delay a Node timer honours (a longer one fires after
 * about 1 ms).
 */

const MAX_TIMER_DELAY_MS = 2_147_483_647;

test('an explicit 0 is kept instead of falling back to the default', () => {
  assert.equal(readMillisecondsEnv('0', 55_000), 0);
  assert.equal(readMillisecondsEnv(' 0 ', 55_000), 0);
});

test('unset, empty, negative and non-numeric values use the fallback', () => {
  for (const raw of [undefined, '', '   ', '-1', 'soon', 'NaN', 'Infinity']) {
    assert.equal(readMillisecondsEnv(raw, 55_000), 55_000, String(raw));
  }
});

test('values above the longest timer delay are clamped to it', () => {
  assert.equal(readMillisecondsEnv(String(MAX_TIMER_DELAY_MS), 1), MAX_TIMER_DELAY_MS);
  assert.equal(readMillisecondsEnv(String(MAX_TIMER_DELAY_MS + 1), 1), MAX_TIMER_DELAY_MS);
  assert.equal(readMillisecondsEnv('86400000000', 1), MAX_TIMER_DELAY_MS);
});

test('ordinary values are whole milliseconds', () => {
  assert.equal(readMillisecondsEnv('120000', 1), 120_000);
  assert.equal(readMillisecondsEnv('1500.9', 1), 1_500);
  assert.equal(readMillisecondsEnv('1e3', 1), 1_000);
});
