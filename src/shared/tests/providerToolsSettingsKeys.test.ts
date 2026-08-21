import assert from 'node:assert/strict';

import { test } from 'vitest';

import { PROVIDER_TOOLS_SETTINGS_STORAGE_KEYS } from '@/shared/constants';

/**
 * The composer resolves a provider's tool-permission settings — including
 * `skipPermissions` — through this map on every send. The lookup used to be a
 * nested ternary whose final branch was Claude's key, so removing a provider's
 * arm would silently make that provider inherit Claude's permissions.
 */

test('every provider resolves to its own settings key', () => {
  const keys = Object.values(PROVIDER_TOOLS_SETTINGS_STORAGE_KEYS);

  assert.equal(new Set(keys).size, keys.length, 'providers must not share a settings key');
});

test('opencode does not fall back to the claude settings key', () => {
  assert.notEqual(
    PROVIDER_TOOLS_SETTINGS_STORAGE_KEYS.opencode,
    PROVIDER_TOOLS_SETTINGS_STORAGE_KEYS.claude,
  );
});

test('the key names match what the settings module writes', () => {
  assert.deepEqual(PROVIDER_TOOLS_SETTINGS_STORAGE_KEYS, {
    claude: 'claude-settings',
    cursor: 'cursor-tools-settings',
    codex: 'codex-settings',
    opencode: 'opencode-settings',
  });
});
