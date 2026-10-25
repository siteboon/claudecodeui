import { describe, expect, it } from 'vitest';

import { getErrorText } from '@/shared/utils';

describe('getErrorText', () => {
  it('returns the bare message when there are no details', () => {
    expect(getErrorText(new Error('boom'))).toBe('boom');
  });

  it('appends string details, such as git stderr', () => {
    const error = Object.assign(new Error('git worktree remove failed'), { details: 'Permission denied' });
    expect(getErrorText(error)).toBe('git worktree remove failed: Permission denied');
  });

  it('joins a list of details, such as conflicting files', () => {
    const error = Object.assign(new Error('Merge has conflicts'), { details: ['a.txt', 'b.txt', 42] });
    expect(getErrorText(error)).toBe('Merge has conflicts: a.txt, b.txt');
  });

  it('stringifies non-Error values', () => {
    expect(getErrorText('nope')).toBe('nope');
  });
});
