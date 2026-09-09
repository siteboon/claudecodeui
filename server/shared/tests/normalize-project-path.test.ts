import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeProjectPath } from '@/shared/utils.js';

// These cases are platform-independent: a path that starts with a drive letter
// takes the Windows rules on every OS (see shouldUseWindowsPathNormalization).

test('normalizeProjectPath uppercases a lowercase Windows drive letter', () => {
  assert.equal(normalizeProjectPath('a:\\work'), 'A:\\work');
});

test('normalizeProjectPath maps both drive-letter spellings to one key', () => {
  assert.equal(normalizeProjectPath('a:\\work\\project'), normalizeProjectPath('A:\\work\\project'));
});

test('normalizeProjectPath leaves the rest of the path case alone', () => {
  assert.equal(normalizeProjectPath('a:\\Work\\SubDir'), 'A:\\Work\\SubDir');
});

test('normalizeProjectPath leaves an uppercase drive letter untouched', () => {
  assert.equal(normalizeProjectPath('C:\\Users\\Someone'), 'C:\\Users\\Someone');
});

test('normalizeProjectPath uppercases the drive letter of a bare root', () => {
  assert.equal(normalizeProjectPath('a:\\'), 'A:\\');
});

test('normalizeProjectPath uppercases the drive letter with forward slashes', () => {
  assert.equal(normalizeProjectPath('a:/work/project/'), 'A:\\work\\project');
});

test('normalizeProjectPath uppercases the drive letter behind a long-path prefix', () => {
  assert.equal(normalizeProjectPath('\\\\?\\a:\\work'), 'A:\\work');
});

test('normalizeProjectPath leaves UNC paths alone - they have no drive letter', () => {
  assert.equal(normalizeProjectPath('\\\\server\\share\\project'), '\\\\server\\share\\project');
});

// POSIX paths take the POSIX branch only off Windows; on win32 they are
// normalized with the Windows rules, which is pre-existing behaviour.
test('normalizeProjectPath keeps POSIX path case', { skip: process.platform === 'win32' }, () => {
  assert.equal(normalizeProjectPath('/Home/user/project'), '/Home/user/project');
  assert.notEqual(normalizeProjectPath('/Home/user'), normalizeProjectPath('/home/user'));
});
