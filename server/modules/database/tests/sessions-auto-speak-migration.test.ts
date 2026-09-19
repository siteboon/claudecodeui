import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, getConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';

type TableColumn = { name: string };

const sessionColumns = (): string[] =>
  (getConnection().prepare('PRAGMA table_info(sessions)').all() as TableColumn[])
    .map((column) => column.name);

/**
 * Upgrading an install is the risky half of adding a column: a fresh database
 * gets it from the schema, while an existing one only gets it if the migration
 * runs. This drops the column from an initialized database to stand in for a
 * pre-feature install, then initializes again.
 */
test('an existing database gains the auto_speak column on upgrade', { concurrency: false }, async () => {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'auto-speak-migration-db-'));

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');

  try {
    await initializeDatabase();
    sessionsDb.createAppSession('upgraded-session', 'claude', '/tmp/auto-speak-migration');
    sessionsDb.setSessionAutoSpeak('upgraded-session', true);

    getConnection().exec('ALTER TABLE sessions DROP COLUMN auto_speak');
    assert.ok(!sessionColumns().includes('auto_speak'), 'column removed to simulate an old install');

    closeConnection();
    await initializeDatabase();

    assert.ok(sessionColumns().includes('auto_speak'), 'migration re-added the column');
    // Pre-existing conversations must not start talking after an upgrade.
    assert.equal(sessionsDb.getSessionAutoSpeak('upgraded-session'), false);
    // And the column is writable afterwards, not just present.
    assert.equal(sessionsDb.setSessionAutoSpeak('upgraded-session', true), true);
    assert.equal(sessionsDb.getSessionAutoSpeak('upgraded-session'), true);
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
});
