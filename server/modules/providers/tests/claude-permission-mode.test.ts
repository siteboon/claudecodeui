import assert from 'node:assert/strict';
import test from 'node:test';

import { mapCliOptionsToSDK } from '@/modules/providers/list/claude/claude-runtime.provider.js';

// A chat turn's 'default' defers to the user's settings (permissions.defaultMode), so the SDK gets no mode.
test('a chat default leaves the mode to the user settings', () => {
  assert.equal(mapCliOptionsToSDK({ permissionMode: 'default' }).permissionMode, undefined);
  assert.equal(mapCliOptionsToSDK({}).permissionMode, undefined);
});

// An Agent API caller that explicitly asked for manual approval must get it, even if the user's settings
// default to bypassPermissions.
test('an explicitly requested default reaches the SDK as manual approval', () => {
  assert.equal(mapCliOptionsToSDK({ permissionMode: 'default', enforcePermissionMode: true }).permissionMode, 'default');
});

test('non-default modes pass through either way', () => {
  for (const mode of ['acceptEdits', 'plan', 'bypassPermissions']) {
    assert.equal(mapCliOptionsToSDK({ permissionMode: mode }).permissionMode, mode);
    assert.equal(mapCliOptionsToSDK({ permissionMode: mode, enforcePermissionMode: true }).permissionMode, mode);
  }
});
