import assert from 'node:assert/strict';
import test from 'node:test';

import { __testResolveGeminiPermissionArgs } from './gemini-cli.js';

test('Gemini CLI maps generic bypass and accept-edits permission modes', () => {
  assert.deepEqual(__testResolveGeminiPermissionArgs({ permissionMode: 'bypassPermissions' }), ['--yolo']);
  assert.deepEqual(__testResolveGeminiPermissionArgs({ permissionMode: 'acceptEdits' }), ['--approval-mode', 'auto_edit']);
});
