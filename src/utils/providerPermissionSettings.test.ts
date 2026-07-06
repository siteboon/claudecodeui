import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getProviderToolsSettings,
  hasLocalProviderPermissionSettings,
  normalizeProviderPermissionSettings,
  readLocalProviderPermissionSettings,
  writeLocalProviderPermissionSettings,
} from './providerPermissionSettings';

function createStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));

  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
    values,
  };
}

test('normalizes provider permission settings from unknown input', () => {
  const settings = normalizeProviderPermissionSettings({
    claude: {
      allowedTools: ['Bash', 123, 'Read'],
      disallowedTools: ['Write'],
      skipPermissions: true,
      useWorktree: true,
      projectSortOrder: 'date',
    },
    cursor: {
      allowedCommands: ['git status'],
      disallowedCommands: [false, 'curl example.com'],
      skipPermissions: true,
    },
    codex: { permissionMode: 'acceptEdits' },
    gemini: { permissionMode: 'auto_edit' },
  });

  assert.deepEqual(settings, {
    claude: {
      allowedTools: ['Bash', 'Read'],
      disallowedTools: ['Write'],
      skipPermissions: true,
      useWorktree: true,
      projectSortOrder: 'date',
    },
    cursor: {
      allowedCommands: ['git status'],
      disallowedCommands: ['curl example.com'],
      skipPermissions: true,
    },
    codex: { permissionMode: 'acceptEdits' },
    gemini: { permissionMode: 'auto_edit' },
  });
});

test('reads and writes legacy local provider permission keys', () => {
  const storage = createStorage({
    'claude-settings': JSON.stringify({
      allowedTools: ['Bash'],
      disallowedTools: ['Write'],
      skipPermissions: true,
      useWorktree: true,
      projectSortOrder: 'date',
    }),
    'cursor-tools-settings': JSON.stringify({
      allowedCommands: ['git status'],
      disallowedCommands: ['curl'],
      skipPermissions: true,
    }),
    'codex-settings': JSON.stringify({ permissionMode: 'bypassPermissions' }),
    'gemini-settings': JSON.stringify({ permissionMode: 'yolo' }),
  });

  assert.equal(hasLocalProviderPermissionSettings(storage), true);
  const settings = readLocalProviderPermissionSettings(storage);

  assert.equal(settings.claude.allowedTools[0], 'Bash');
  assert.equal(settings.cursor.allowedCommands[0], 'git status');
  assert.equal(settings.codex.permissionMode, 'bypassPermissions');
  assert.equal(settings.gemini.permissionMode, 'yolo');

  writeLocalProviderPermissionSettings(
    {
      ...settings,
      claude: { ...settings.claude, projectSortOrder: 'name' },
      codex: { permissionMode: 'default' },
    },
    storage,
    '2026-07-05T00:00:00.000Z',
  );

  assert.deepEqual(JSON.parse(storage.values.get('codex-settings') || '{}'), {
    permissionMode: 'default',
    lastUpdated: '2026-07-05T00:00:00.000Z',
  });
  assert.deepEqual(JSON.parse(storage.values.get('claude-settings') || '{}'), {
    allowedTools: ['Bash'],
    disallowedTools: ['Write'],
    skipPermissions: true,
    useWorktree: true,
    projectSortOrder: 'name',
    lastUpdated: '2026-07-05T00:00:00.000Z',
  });
});

test('maps provider settings to chat tools settings payloads', () => {
  const settings = normalizeProviderPermissionSettings({
    claude: { allowedTools: ['Bash'], disallowedTools: ['Write'], skipPermissions: true, useWorktree: true },
    cursor: { allowedCommands: ['git status'], disallowedCommands: ['curl'], skipPermissions: true },
    codex: { permissionMode: 'acceptEdits' },
    gemini: { permissionMode: 'yolo' },
  });

  assert.deepEqual(getProviderToolsSettings('claude', settings), {
    allowedTools: ['Bash'],
    disallowedTools: ['Write'],
    skipPermissions: true,
    useWorktree: true,
    projectSortOrder: 'name',
  });
  assert.deepEqual(getProviderToolsSettings('cursor', settings), {
    allowedCommands: ['git status'],
    disallowedCommands: ['curl'],
    skipPermissions: true,
  });
  assert.deepEqual(getProviderToolsSettings('codex', settings), {
    permissionMode: 'acceptEdits',
  });
  assert.deepEqual(getProviderToolsSettings('gemini', settings), {
    permissionMode: 'yolo',
  });
});
