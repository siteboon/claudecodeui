import assert from 'node:assert/strict';
import test from 'node:test';

import {
  findWorktreeEntryByPath,
  parseWorktreeListPorcelain,
  validateWorktreeBranchName,
} from '@/modules/worktrees/services/worktree-git.service.js';
import { AppError } from '@/shared/utils.js';

const SAMPLE_PORCELAIN = [
  'worktree /home/user/repo',
  'HEAD 1111111111111111111111111111111111111111',
  'branch refs/heads/main',
  '',
  'worktree /home/user/repo-worktrees/feature-login',
  'HEAD 2222222222222222222222222222222222222222',
  'branch refs/heads/feature/login',
  '',
  'worktree /home/user/repo-worktrees/spike',
  'HEAD 3333333333333333333333333333333333333333',
  'detached',
  'locked reason text',
  '',
].join('\n');

test('parseWorktreeListPorcelain parses main, branch, detached and locked entries', () => {
  const entries = parseWorktreeListPorcelain(SAMPLE_PORCELAIN);

  assert.equal(entries.length, 3);

  assert.equal(entries[0].branch, 'main');
  assert.equal(entries[0].headSha, '1111111111111111111111111111111111111111');
  assert.equal(entries[0].isDetached, false);

  assert.equal(entries[1].branch, 'feature/login');
  assert.ok(entries[1].path.endsWith('feature-login'));

  assert.equal(entries[2].branch, null);
  assert.equal(entries[2].isDetached, true);
  assert.equal(entries[2].isLocked, true);
});

test('parseWorktreeListPorcelain handles output without a trailing blank line', () => {
  const entries = parseWorktreeListPorcelain(
    'worktree /home/user/repo\nHEAD 1111111111111111111111111111111111111111\nbranch refs/heads/main',
  );

  assert.equal(entries.length, 1);
  assert.equal(entries[0].branch, 'main');
});

test('findWorktreeEntryByPath matches normalized paths', () => {
  const entries = parseWorktreeListPorcelain(SAMPLE_PORCELAIN);
  const found = findWorktreeEntryByPath(entries, '/home/user/repo-worktrees/feature-login/');
  assert.equal(found.branch, 'feature/login');
});

test('findWorktreeEntryByPath throws a 404 AppError for unknown paths', () => {
  const entries = parseWorktreeListPorcelain(SAMPLE_PORCELAIN);
  assert.throws(
    () => findWorktreeEntryByPath(entries, '/home/user/elsewhere'),
    (error: unknown) =>
      error instanceof AppError && error.code === 'WORKTREE_NOT_FOUND' && error.statusCode === 404,
  );
});

test('validateWorktreeBranchName accepts slash-separated branch names', () => {
  assert.equal(validateWorktreeBranchName(' feature/login-form '), 'feature/login-form');
});

test('validateWorktreeBranchName rejects unsafe names', () => {
  for (const invalidName of [
    '', '   ', '-oops', '.', '..', 'bad name', 'bad;name', 'bad$(name)',
    'foo..bar', 'foo.', 'foo//bar', 'foo.lock', 'feature/foo.LOCK', '/feature', 'feature/',
    '.hidden', 'feature/.hidden', 'feature/./name',
  ]) {
    assert.throws(
      () => validateWorktreeBranchName(invalidName),
      (error: unknown) => error instanceof AppError && error.code === 'INVALID_BRANCH_NAME',
      `expected "${invalidName}" to be rejected`,
    );
  }
});
