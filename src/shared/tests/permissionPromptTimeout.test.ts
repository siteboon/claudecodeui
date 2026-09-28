import { describe, expect, it } from 'vitest';

import { readPermissionPromptTimeoutMs } from '@/shared/utils';

// Issue #607: the stored Claude permission prompt timeout is read the way the
// server applies it, so Settings never shows a timeout other than the one in
// effect.

const MAX_TIMER_DELAY_MS = 2 ** 31 - 1;

describe('readPermissionPromptTimeoutMs', () => {
  // [what is stored, what it reads as, the stored value]
  it.each<[string, number, unknown]>([
    ['absent (saved by an older client)', 0, undefined],
    ['null', 0, null],
    ['0', 0, 0],
    ['a negative number', 0, -1],
    ['a fraction', 0, 1.5],
    ['NaN', 0, Number.NaN],
    ['Infinity', 0, Number.POSITIVE_INFINITY],
    ['a numeric string', 0, '300000'],
    ['an object', 0, { ms: 300_000 }],
    ['a preset', 300_000, 300_000],
    ['a custom whole number', 90_000, 90_000],
    ['the longest timeout the server applies', MAX_TIMER_DELAY_MS, MAX_TIMER_DELAY_MS],
  ])('reads %s as %s', (_label, expected, stored) => {
    expect(readPermissionPromptTimeoutMs(stored)).toBe(expected);
  });

  it('caps a longer timeout at what the server applies', () => {
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    expect(readPermissionPromptTimeoutMs(thirtyDaysMs)).toBe(MAX_TIMER_DELAY_MS);
  });
});
