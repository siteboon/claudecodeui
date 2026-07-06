import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase } from '@/modules/database/index.js';

async function withIsolatedDatabase(runTest: () => Promise<void> | void) {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'provider-permissions-'));

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'settings.db');
  await initializeDatabase();

  try {
    await runTest();
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

test('provider permission settings start as unstored defaults', async () => {
  await withIsolatedDatabase(async () => {
    const { getProviderPermissionSettingsRecord } = await import(
      './provider-permission-settings.service.js'
    );

    const record = getProviderPermissionSettingsRecord();

    assert.equal(record.stored, false);
    assert.deepEqual(record.settings, {
      claude: {
        allowedTools: [],
        disallowedTools: [],
        skipPermissions: false,
        useWorktree: false,
        projectSortOrder: 'name',
      },
      cursor: {
        allowedCommands: [],
        disallowedCommands: [],
        skipPermissions: false,
      },
      codex: {
        permissionMode: 'default',
      },
      gemini: {
        permissionMode: 'default',
      },
    });
  });
});

test('provider permission settings are normalized and persisted', async () => {
  await withIsolatedDatabase(async () => {
    const {
      getProviderPermissionSettingsRecord,
      updateProviderPermissionSettings,
    } = await import('./provider-permission-settings.service.js');

    const saved = updateProviderPermissionSettings({
      claude: {
        allowedTools: ['Bash', 42, 'Read'],
        disallowedTools: ['rm -rf /'],
        skipPermissions: true,
        useWorktree: true,
        projectSortOrder: 'date',
      },
      cursor: {
        allowedCommands: ['git status'],
        disallowedCommands: ['curl example.com'],
        skipPermissions: true,
      },
      codex: {
        permissionMode: 'bypassPermissions',
      },
      gemini: {
        permissionMode: 'yolo',
      },
    });

    assert.deepEqual(saved, {
      claude: {
        allowedTools: ['Bash', 'Read'],
        disallowedTools: ['rm -rf /'],
        skipPermissions: true,
        useWorktree: true,
        projectSortOrder: 'date',
      },
      cursor: {
        allowedCommands: ['git status'],
        disallowedCommands: ['curl example.com'],
        skipPermissions: true,
      },
      codex: {
        permissionMode: 'bypassPermissions',
      },
      gemini: {
        permissionMode: 'yolo',
      },
    });

    const record = getProviderPermissionSettingsRecord();

    assert.equal(record.stored, true);
    assert.deepEqual(record.settings, saved);
  });
});

test('provider permission settings are isolated by user id', async () => {
  await withIsolatedDatabase(async () => {
    const {
      getProviderPermissionSettingsRecord,
      updateProviderPermissionSettings,
    } = await import('./provider-permission-settings.service.js');

    updateProviderPermissionSettings({
      claude: {
        allowedTools: ['Bash'],
        skipPermissions: true,
      },
    }, 'user-a');

    const userA = getProviderPermissionSettingsRecord('user-a');
    const userB = getProviderPermissionSettingsRecord('user-b');

    assert.equal(userA.stored, true);
    assert.deepEqual(userA.settings.claude.allowedTools, ['Bash']);
    assert.equal(userB.stored, false);
    assert.deepEqual(userB.settings.claude.allowedTools, []);
  });
});
