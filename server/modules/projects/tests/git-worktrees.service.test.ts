import assert from 'node:assert/strict';
import test from 'node:test';

import { parseWorktreePorcelain } from '@/modules/projects/services/git-worktrees.service.js';

test('single-worktree repo: one main entry', () => {
  const porcelain = [
    'worktree /Users/me/repo',
    'HEAD aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111',
    'branch refs/heads/main',
    '',
  ].join('\n');

  const result = parseWorktreePorcelain(porcelain);

  assert.deepEqual(result, [
    { path: '/Users/me/repo', branch: 'main', isMain: true, isLocked: false },
  ]);
});

test('multiple worktrees: first is main, others are not', () => {
  const porcelain = [
    'worktree /Users/me/repo',
    'HEAD aaaa',
    'branch refs/heads/main',
    '',
    'worktree /Users/me/wt/feat-x',
    'HEAD bbbb',
    'branch refs/heads/feat-x',
    '',
  ].join('\n');

  const result = parseWorktreePorcelain(porcelain);

  assert.equal(result.length, 2);
  assert.equal(result[0].isMain, true);
  assert.equal(result[1].isMain, false);
  assert.equal(result[1].branch, 'feat-x');
});

test('detached HEAD: branch is null', () => {
  const porcelain = [
    'worktree /Users/me/repo',
    'HEAD aaaa',
    'branch refs/heads/main',
    '',
    'worktree /Users/me/wt/detached',
    'HEAD cccc',
    'detached',
    '',
  ].join('\n');

  const result = parseWorktreePorcelain(porcelain);

  assert.equal(result.length, 2);
  assert.equal(result[1].branch, null);
});

test('locked worktree: isLocked true', () => {
  const porcelain = [
    'worktree /Users/me/repo',
    'HEAD aaaa',
    'branch refs/heads/main',
    '',
    'worktree /Users/me/wt/locked',
    'HEAD dddd',
    'branch refs/heads/wip',
    'locked some reason',
    '',
  ].join('\n');

  const result = parseWorktreePorcelain(porcelain);

  assert.equal(result.length, 2);
  assert.equal(result[1].isLocked, true);
  assert.equal(result[1].branch, 'wip');
});

test('bare worktree: skipped, next entry becomes main', () => {
  const porcelain = [
    'worktree /Users/me/bare-repo',
    'bare',
    '',
    'worktree /Users/me/wt/main',
    'HEAD aaaa',
    'branch refs/heads/main',
    '',
  ].join('\n');

  const result = parseWorktreePorcelain(porcelain);

  assert.equal(result.length, 1);
  assert.equal(result[0].path, '/Users/me/wt/main');
  assert.equal(result[0].isMain, true);
});

test('empty input: returns empty array', () => {
  assert.deepEqual(parseWorktreePorcelain(''), []);
});

test('CRLF line endings: still parses correctly', () => {
  const porcelain = [
    'worktree /Users/me/repo',
    'HEAD aaaa',
    'branch refs/heads/main',
    '',
  ].join('\r\n');

  const result = parseWorktreePorcelain(porcelain);

  assert.equal(result.length, 1);
  assert.equal(result[0].path, '/Users/me/repo');
  assert.equal(result[0].branch, 'main');
});

test('branch with slashes: prefix stripped, slashes preserved', () => {
  const porcelain = [
    'worktree /Users/me/repo',
    'HEAD aaaa',
    'branch refs/heads/feature/auth-refactor',
    '',
  ].join('\n');

  const result = parseWorktreePorcelain(porcelain);

  assert.equal(result[0].branch, 'feature/auth-refactor');
});
