import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { isPathWithinRoot } from '@/shared/utils.js';

test('isPathWithinRoot accepts the POSIX filesystem root and its descendants', () => {
  assert.equal(isPathWithinRoot('/', '/', path.posix), true);
  assert.equal(isPathWithinRoot('/', '/home/user/project', path.posix), true);
});

test('isPathWithinRoot accepts a Windows drive root and its descendants', () => {
  assert.equal(isPathWithinRoot('C:\\', 'C:\\', path.win32), true);
  assert.equal(isPathWithinRoot('C:\\', 'C:\\Users\\someone\\project', path.win32), true);
});

test('isPathWithinRoot rejects paths on a different Windows drive', () => {
  assert.equal(isPathWithinRoot('C:\\', 'D:\\project', path.win32), false);
});

test('isPathWithinRoot accepts a nested root and its descendants', () => {
  assert.equal(isPathWithinRoot('/workspaces', '/workspaces', path.posix), true);
  assert.equal(isPathWithinRoot('/workspaces', '/workspaces/project/src', path.posix), true);
});

test('isPathWithinRoot rejects parent traversal and sibling paths', () => {
  assert.equal(isPathWithinRoot('/workspaces', '/', path.posix), false);
  assert.equal(isPathWithinRoot('/workspaces', '/etc/passwd', path.posix), false);
  assert.equal(isPathWithinRoot('/workspaces/project', '/workspaces/other', path.posix), false);
});

test('isPathWithinRoot does not match on partial path segments', () => {
  assert.equal(isPathWithinRoot('/home/user', '/home/username/project', path.posix), false);
  assert.equal(isPathWithinRoot('C:\\Users', 'C:\\UsersOther', path.win32), false);
});

test('isPathWithinRoot accepts descendant names that start with ..', () => {
  assert.equal(isPathWithinRoot('/workspaces', '/workspaces/..cache', path.posix), true);
  assert.equal(isPathWithinRoot('C:\\workspaces', 'C:\\workspaces\\..cache', path.win32), true);
});
