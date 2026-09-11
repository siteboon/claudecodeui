import assert from 'node:assert/strict';
import test from 'node:test';

import { isPathWithinRoot, normalizeProjectPath } from '@/shared/utils.js';

test('isPathWithinRoot accepts paths under a Windows drive root (issue #746)', () => {
  const root = normalizeProjectPath('D:\\');
  assert.equal(root, 'D:\\');
  assert.equal(isPathWithinRoot(normalizeProjectPath('D:\\Claude code'), root), true);
  assert.equal(isPathWithinRoot(normalizeProjectPath('D:\\work\\project'), root), true);
});

test('isPathWithinRoot also accepts the bare drive form for a drive root', () => {
  const root = normalizeProjectPath('D:');
  assert.equal(isPathWithinRoot(normalizeProjectPath('D:\\Claude code'), root), true);
});

test('isPathWithinRoot matches the drive root itself', () => {
  const root = normalizeProjectPath('D:\\');
  assert.equal(isPathWithinRoot('D:\\', root), true);
});

test('isPathWithinRoot rejects paths on a different drive', () => {
  const root = normalizeProjectPath('D:\\');
  assert.equal(isPathWithinRoot(normalizeProjectPath('C:\\Users\\someone'), root), false);
});

test('isPathWithinRoot compares Windows paths case-insensitively', () => {
  const root = normalizeProjectPath('C:\\Users\\lihong');
  assert.equal(isPathWithinRoot(normalizeProjectPath('c:\\users\\LIHONG\\proj'), root), true);
});

test('isPathWithinRoot does not match on partial path segments', () => {
  const root = normalizeProjectPath('C:\\Users');
  assert.equal(isPathWithinRoot(normalizeProjectPath('C:\\UsersOther'), root), false);
});

test('isPathWithinRoot keeps POSIX containment behavior', () => {
  const root = normalizeProjectPath('/home/user');
  assert.equal(isPathWithinRoot(normalizeProjectPath('/home/user/project'), root), true);
  assert.equal(isPathWithinRoot(normalizeProjectPath('/home/user'), root), true);
  assert.equal(isPathWithinRoot(normalizeProjectPath('/etc/passwd'), root), false);
  assert.equal(isPathWithinRoot(normalizeProjectPath('/home/username/project'), root), false);
});
