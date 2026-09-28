import assert from 'node:assert/strict';

import { afterEach, beforeEach, test, vi } from 'vitest';

import { buildClaudeToolPermissionEntry, grantClaudeToolPermission } from '@/modules/chat/utils/chatPermissions';
import { readUserPreference, resetUserPreferences, writeUserPreference } from '@/shared/userSettings';

beforeEach(() => {
  // Preference writes are pushed to the server on a debounce.
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
  resetUserPreferences();
  localStorage.clear();
});

afterEach(() => {
  // Also drops the debounced save a write queued.
  resetUserPreferences();
  vi.unstubAllGlobals();
  localStorage.clear();
});

test('buildClaudeToolPermissionEntry derives a scoped git command from JSON input', () => {
  assert.equal(
    buildClaudeToolPermissionEntry('Bash', JSON.stringify({ command: 'git status' })),
    'Bash(git status:*)',
  );
});

test('buildClaudeToolPermissionEntry falls back to the tool name for malformed JSON', () => {
  assert.equal(buildClaudeToolPermissionEntry('Bash', '{"command":'), 'Bash');
});

test('buildClaudeToolPermissionEntry accepts an already parsed tool input', () => {
  assert.equal(buildClaudeToolPermissionEntry('Bash', { command: 'npm test' }), 'Bash(npm:*)');
});

test('buildClaudeToolPermissionEntry rejects JSON with no string command', () => {
  assert.equal(buildClaudeToolPermissionEntry('Bash', JSON.stringify({ command: false })), 'Bash');
});

test('granting a tool from the chat keeps the permission prompt timeout set in Settings', () => {
  // The grant rewrites the whole `claudePermissions` preference; a field it
  // does not carry is lost (issue #607's timeout lives there too).
  writeUserPreference('claudePermissions', {
    allowedTools: ['Read'],
    disallowedTools: ['Write'],
    skipPermissions: false,
    permissionPromptTimeoutMs: 300_000,
  });

  const result = grantClaudeToolPermission('Write');

  assert.equal(result.success, true);
  assert.deepEqual(readUserPreference('claudePermissions', null), {
    allowedTools: ['Read', 'Write'],
    disallowedTools: [],
    skipPermissions: false,
    permissionPromptTimeoutMs: 300_000,
  });
});

test('granting a tool for a user who never set a timeout stores "wait indefinitely"', () => {
  writeUserPreference('claudePermissions', { allowedTools: [], disallowedTools: [], skipPermissions: true });

  grantClaudeToolPermission('Bash(npm:*)');

  assert.deepEqual(readUserPreference('claudePermissions', null), {
    allowedTools: ['Bash(npm:*)'],
    disallowedTools: [],
    skipPermissions: true,
    permissionPromptTimeoutMs: 0,
  });
});
