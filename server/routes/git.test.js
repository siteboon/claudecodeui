import assert from 'node:assert/strict';
import test from 'node:test';

import { parseGitStatusOutput } from './git.js';

// Builds `git status --porcelain=v1 -z` output: NUL-separated entries with a
// trailing NUL, exactly as git emits it.
const porcelain = (...entries) => entries.join('\0') + '\0';

test('parseGitStatusOutput buckets files and reports index-side staging', () => {
  const output = porcelain(
    'M  staged-modified.ts',
    ' M unstaged-modified.ts',
    'MM staged-and-unstaged.ts',
    'A  staged-new.ts',
    'D  staged-deleted.ts',
    ' D unstaged-deleted.ts',
    '?? untracked.ts',
  );

  const result = parseGitStatusOutput(output);

  assert.deepEqual(result.modified, ['staged-modified.ts', 'unstaged-modified.ts', 'staged-and-unstaged.ts']);
  assert.deepEqual(result.added, ['staged-new.ts']);
  assert.deepEqual(result.deleted, ['staged-deleted.ts', 'unstaged-deleted.ts']);
  assert.deepEqual(result.untracked, ['untracked.ts']);
  // Only index-side (X) changes count as staged.
  assert.deepEqual(result.staged, [
    'staged-modified.ts',
    'staged-and-unstaged.ts',
    'staged-new.ts',
    'staged-deleted.ts',
  ]);
});

test('parseGitStatusOutput keeps paths with spaces intact (-z output has no quoting)', () => {
  const result = parseGitStatusOutput(porcelain('M  src/my folder/some file.ts'));
  assert.deepEqual(result.modified, ['src/my folder/some file.ts']);
  assert.deepEqual(result.staged, ['src/my folder/some file.ts']);
});

test('parseGitStatusOutput tracks the post-rename path and skips the original', () => {
  const output = porcelain('R  renamed-to.ts', 'renamed-from.ts', ' M other.ts');
  const result = parseGitStatusOutput(output);

  assert.deepEqual(result.modified, ['renamed-to.ts', 'other.ts']);
  assert.deepEqual(result.staged, ['renamed-to.ts']);
  // The pre-rename path is metadata, not a change entry.
  assert.equal(JSON.stringify(result).includes('renamed-from.ts'), false);
});

test('parseGitStatusOutput never reports merge conflicts as staged', () => {
  const output = porcelain('UU conflicted.ts', 'AA both-added.ts', 'DD both-deleted.ts');
  const result = parseGitStatusOutput(output);

  assert.deepEqual(result.modified, ['conflicted.ts', 'both-added.ts', 'both-deleted.ts']);
  assert.deepEqual(result.staged, []);
});

test('parseGitStatusOutput handles empty output', () => {
  assert.deepEqual(parseGitStatusOutput(''), {
    modified: [],
    added: [],
    deleted: [],
    untracked: [],
    staged: [],
  });
});
