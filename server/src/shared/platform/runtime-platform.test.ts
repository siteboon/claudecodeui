import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getPlatformLineEnding,
  getPlatformPathSeparator,
  isWindowsPlatform,
  resolveRuntimePlatform,
} from './runtime-platform.js';

// This test covers the platform vocabulary used by the adapter layer.
test('resolveRuntimePlatform maps Node platforms into adapter platforms', () => {
  assert.equal(resolveRuntimePlatform('win32'), 'windows');
  assert.equal(resolveRuntimePlatform('darwin'), 'macos');
  assert.equal(resolveRuntimePlatform('linux'), 'linux');
  assert.equal(resolveRuntimePlatform('freebsd'), 'linux');
});

// This test verifies the shared helpers expose the expected OS defaults.
test('platform helpers expose the expected line endings and separators', () => {
  assert.equal(isWindowsPlatform('windows'), true);
  assert.equal(isWindowsPlatform('linux'), false);
  assert.equal(getPlatformLineEnding('windows'), 'crlf');
  assert.equal(getPlatformLineEnding('linux'), 'lf');
  assert.equal(getPlatformPathSeparator('windows'), '\\');
  assert.equal(getPlatformPathSeparator('macos'), '/');
});
