import assert from 'node:assert/strict';
import test from 'node:test';

import { arePathsEquivalent, normalizePathForPlatform, toPortablePath } from './path.js';

// This test verifies path strings can be normalized for logs and platform-specific execution.
test('path helpers normalize separators in both directions', () => {
  assert.equal(toPortablePath('folder\\child\\file.txt'), 'folder/child/file.txt');
  assert.equal(
    normalizePathForPlatform('folder\\child/file.txt', 'windows'),
    'folder\\child\\file.txt',
  );
  assert.equal(
    normalizePathForPlatform('folder\\child/file.txt', 'linux'),
    'folder/child/file.txt',
  );
});

// This test verifies path comparison respects Windows case-insensitivity but POSIX case-sensitivity.
test('arePathsEquivalent follows the case rules of the target platform', () => {
  assert.equal(
    arePathsEquivalent('C:\\Repo\\File.txt', 'c:/repo/file.txt', 'windows'),
    true,
  );
  assert.equal(
    arePathsEquivalent('/repo/File.txt', '/repo/file.txt', 'linux'),
    false,
  );
});
