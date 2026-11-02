import { describe, expect, it } from 'vitest';

import { calculateDiff, summarizeDiff } from '@/modules/chat/utils/messageTransforms';

const count = (oldStr: string, newStr: string) => summarizeDiff(calculateDiff(oldStr, newStr));

describe('diff line counting', () => {
  it('counts a replaced line as one added and one removed', () => {
    expect(count('a\nb\nc', 'a\nB\nc')).toEqual({ added: 1, removed: 1 });
  });

  it('counts a pure insertion with nothing removed', () => {
    expect(count('a\nc', 'a\nb\nc')).toEqual({ added: 1, removed: 0 });
  });

  it('counts a pure deletion with nothing added', () => {
    expect(count('a\nb\nc', 'a\nc')).toEqual({ added: 0, removed: 1 });
  });

  it('reports nothing for an edit that changes nothing', () => {
    expect(count('a\nb\nc', 'a\nb\nc')).toEqual({ added: 0, removed: 0 });
  });

  // Write passes '' as the "before" for a file that did not exist. Splitting
  // that on '\n' yields [''] — one phantom blank line — which used to be
  // reported as a deletion and drawn as a stray empty red row.
  it('treats a new file as pure additions whether or not it ends in a newline', () => {
    expect(count('', 'a\nb\nc')).toEqual({ added: 3, removed: 0 });
    expect(count('', 'a\nb\nc\n')).toEqual({ added: 3, removed: 0 });
  });

  it('treats emptying a file as pure deletions', () => {
    expect(count('a\nb\nc', '')).toEqual({ added: 0, removed: 3 });
  });

  // A trailing newline terminates the last line; it does not start a new blank
  // one. Otherwise the same content counts differently depending on whether
  // the file happens to end in a newline.
  it('does not count a trailing newline as an extra line', () => {
    expect(count('a\nb', 'a\nb\n')).toEqual({ added: 0, removed: 0 });
    expect(count('a\nb\n', 'a\nb\nc\n')).toEqual({ added: 1, removed: 0 });
  });

  it('still counts a genuinely blank trailing line', () => {
    expect(count('a\n', 'a\n\n')).toEqual({ added: 1, removed: 0 });
  });

  it('reports both sides for an empty-to-empty edit', () => {
    expect(count('', '')).toEqual({ added: 0, removed: 0 });
  });

  it('renders no diff rows for a new file beyond its own lines', () => {
    const lines = calculateDiff('', 'a\nb\nc');
    expect(lines.map((line) => line.type)).toEqual(['added', 'added', 'added']);
    expect(lines.map((line) => line.content)).toEqual(['a', 'b', 'c']);
  });
});
