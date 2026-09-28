import assert from 'node:assert/strict';
import test from 'node:test';

import { resolvePermissionPromptTimeoutMs } from '@/modules/providers/list/claude/claude-runtime.provider.js';

/**
 * `permissionPromptTimeoutMs` arrives from the client inside `toolsSettings`,
 * so the runtime cannot trust its shape: it was saved by whatever client
 * version the user last had, and scheduled or queued turns replay a snapshot
 * of it. Only a real, positive whole number of milliseconds turns a timeout
 * on; everything else keeps the default of waiting for the user (issue #607).
 */

/** Node's setTimeout ceiling; a longer delay overflows and fires after 1 ms. */
const MAX_TIMER_MS = 2 ** 31 - 1;

test('a positive whole number of milliseconds is used as the timeout', () => {
  assert.equal(resolvePermissionPromptTimeoutMs(1), 1);
  assert.equal(resolvePermissionPromptTimeoutMs(60_000), 60_000);
  assert.equal(resolvePermissionPromptTimeoutMs(60 * 60 * 1000), 60 * 60 * 1000);
});

test('a timeout longer than a Node timer can hold is clamped rather than overflowing', () => {
  assert.equal(resolvePermissionPromptTimeoutMs(MAX_TIMER_MS), MAX_TIMER_MS, 'the ceiling itself is kept');
  assert.equal(resolvePermissionPromptTimeoutMs(MAX_TIMER_MS + 1), MAX_TIMER_MS);
  assert.equal(resolvePermissionPromptTimeoutMs(30 * 24 * 60 * 60 * 1000), MAX_TIMER_MS, '30 days');
  assert.equal(resolvePermissionPromptTimeoutMs(Number.MAX_SAFE_INTEGER), MAX_TIMER_MS);
  assert.equal(resolvePermissionPromptTimeoutMs(1e300), MAX_TIMER_MS);
});

test('anything else means no timeout: wait for the user', () => {
  const noTimeout: Array<[string, unknown]> = [
    ['absent', undefined],
    ['null', null],
    ['zero', 0],
    ['negative zero', -0],
    ['negative', -1],
    ['large negative', -60_000],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
    ['fraction', 1.5],
    ['sub-millisecond', 0.5],
    ['numeric string', '60000'],
    ['empty string', ''],
    ['boolean', true],
    ['object', { ms: 60_000 }],
    ['array', [60_000]],
    ['bigint', 60_000n],
  ];

  for (const [label, value] of noTimeout) {
    assert.equal(resolvePermissionPromptTimeoutMs(value), 0, label);
  }
});
