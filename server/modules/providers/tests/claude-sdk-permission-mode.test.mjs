import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSdkPermissionMode } from '../../../../dist-server/server/claude-sdk.js';

// This test validates the compiled server artifact, so run it through
// `npm run test:claude-sdk-permissions`, which rebuilds dist-server first.

test('maps skipPermissions to dontAsk for root Claude SDK sessions', () => {
  assert.equal(resolveSdkPermissionMode('default', { skipPermissions: true }, { isRoot: true }), 'dontAsk');
});

test('maps skipPermissions to bypassPermissions for non-root Claude SDK sessions', () => {
  assert.equal(resolveSdkPermissionMode('default', { skipPermissions: true }, { isRoot: false }), 'bypassPermissions');
});

test('preserves plan mode when skipPermissions is enabled', () => {
  assert.equal(resolveSdkPermissionMode('plan', { skipPermissions: true }, { isRoot: true }), 'plan');
});

test('preserves explicit non-default permission modes when skipPermissions is disabled', () => {
  assert.equal(resolveSdkPermissionMode('acceptEdits', { skipPermissions: false }, { isRoot: true }), 'acceptEdits');
});

test('maps explicit bypassPermissions to dontAsk for root Claude SDK sessions', () => {
  assert.equal(resolveSdkPermissionMode('bypassPermissions', { skipPermissions: false }, { isRoot: true }), 'dontAsk');
});

test('preserves explicit bypassPermissions for non-root Claude SDK sessions', () => {
  assert.equal(resolveSdkPermissionMode('bypassPermissions', { skipPermissions: false }, { isRoot: false }), 'bypassPermissions');
});
