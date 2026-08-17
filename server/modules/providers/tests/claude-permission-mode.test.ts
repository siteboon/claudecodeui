import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveClaudePermissionMode } from '../list/claude/claude-permission-mode.js';


test('an explicit default is forwarded rather than dropped', () => {
  // Dropping it lets the user's own settings.json defaultMode decide instead.
  assert.equal(resolveClaudePermissionMode('default', false), 'default');
});


test('an explicit mode outranks the global skipPermissions setting', () => {
  assert.equal(resolveClaudePermissionMode('default', true), 'default');
  assert.equal(resolveClaudePermissionMode('acceptEdits', true), 'acceptEdits');
  assert.equal(resolveClaudePermissionMode('plan', true), 'plan');
});


test('an omitted mode keeps the existing Web-session behaviour', () => {
  assert.equal(resolveClaudePermissionMode(undefined, true), 'bypassPermissions');
  assert.equal(resolveClaudePermissionMode(undefined, false), undefined);
});


test('modes the SDK gained later pass through without a code change', () => {
  // The union comes from the SDK, so 'dontAsk' and 'auto' need no local edit.
  assert.equal(resolveClaudePermissionMode('dontAsk', true), 'dontAsk');
  assert.equal(resolveClaudePermissionMode('auto', false), 'auto');
});
