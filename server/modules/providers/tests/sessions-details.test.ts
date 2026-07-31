import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, projectsDb, sessionsDb } from '@/modules/database/index.js';
import { sessionsService } from '@/modules/providers/services/sessions.service.js';
import { AppError, normalizeProjectPath } from '@/shared/utils.js';

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'sessions-details-'));
  const databasePath = path.join(tempDirectory, 'auth.db');

  closeConnection();
  process.env.DATABASE_PATH = databasePath;
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

test('getSessionDetailsById resolves the owning project for a disk-indexed session', async () => {
  await withIsolatedDatabase(() => {
    const projectPath = '/home/user/example-project';
    const sessionId = sessionsDb.createSession('provider-abc', 'claude', projectPath, 'My session');
    const projectRow = projectsDb.getProjectPath(projectPath);
    assert.ok(projectRow, 'project row should exist after createSession');

    const details = sessionsService.getSessionDetailsById(sessionId);

    assert.equal(details.sessionId, sessionId);
    assert.equal(details.provider, 'claude');
    assert.equal(details.summary, 'My session');
    assert.equal(details.isArchived, false);
    assert.ok(details.project, 'project should be resolved');
    assert.equal(details.project?.projectId, projectRow?.project_id);
    // Paths are normalized to platform separators when stored.
    assert.equal(details.project?.fullPath, normalizeProjectPath(projectPath));
  });
});

test('getSessionDetailsById falls back to the provider-native id and returns the canonical app id', async () => {
  await withIsolatedDatabase(() => {
    const projectPath = '/home/user/alias-project';
    const appSessionId = sessionsDb.createAppSession('app-session-1', 'claude', projectPath);
    sessionsDb.assignProviderSessionId(appSessionId, 'provider-native-1');

    const details = sessionsService.getSessionDetailsById('provider-native-1');

    assert.equal(details.sessionId, appSessionId);
    assert.equal(details.project?.fullPath, normalizeProjectPath(projectPath));
  });
});

test('getSessionDetailsById throws SESSION_NOT_FOUND for unknown ids', async () => {
  await withIsolatedDatabase(() => {
    assert.throws(
      () => sessionsService.getSessionDetailsById('does-not-exist'),
      (error: unknown) => error instanceof AppError && error.code === 'SESSION_NOT_FOUND',
    );
  });
});
