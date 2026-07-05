import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { sessionsService } from '@/modules/providers/services/sessions.service.js';

async function withIsolatedDatabase(runTest: (tempDirectory: string) => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'sessions-service-'));

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  await initializeDatabase();

  try {
    await runTest(tempDirectory);
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

test('archives all active sessions for one project path', async () => {
  await withIsolatedDatabase(async () => {
    sessionsDb.createSession('session-one', 'claude', '/workspace/project-a', 'One');
    sessionsDb.createSession('session-two', 'codex', '/workspace/project-a', 'Two');
    sessionsDb.createSession('session-other', 'claude', '/workspace/project-b', 'Other');

    const result = await sessionsService.deleteOrArchiveSessionsByProjectPath('/workspace/project-a');

    assert.deepEqual(result, {
      projectPath: '/workspace/project-a',
      action: 'archived',
      count: 2,
      deletedFromDisk: 0,
    });
    assert.equal(sessionsDb.getSessionById('session-one')?.isArchived, 1);
    assert.equal(sessionsDb.getSessionById('session-two')?.isArchived, 1);
    assert.equal(sessionsDb.getSessionById('session-other')?.isArchived, 0);
  });
});
