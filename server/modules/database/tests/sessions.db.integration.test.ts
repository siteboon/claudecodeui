import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import Database from 'better-sqlite3';

import { closeConnection } from '@/modules/database/connection.js';
import { initializeDatabase } from '@/modules/database/init-db.js';
import { sessionsDb } from '@/modules/database/repositories/sessions.db.js';

async function withIsolatedDatabase(
  runTest: () => void | Promise<void>,
  prepareDatabase?: (databasePath: string) => void,
): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'sessions-db-'));
  const databasePath = path.join(tempDirectory, 'auth.db');

  closeConnection();
  process.env.DATABASE_PATH = databasePath;
  prepareDatabase?.(databasePath);
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

test('migration preserves legacy session names as manual overrides', async () => {
  await withIsolatedDatabase(() => {
    const migrated = sessionsDb.getSessionById('legacy-manual');
    assert.equal(migrated?.custom_name_source, 'manual');

    sessionsDb.updateSessionProviderName('legacy-manual', 'Codex title');
    assert.equal(sessionsDb.getSessionById('legacy-manual')?.custom_name, 'My existing name');
  }, (databasePath) => {
    const db = new Database(databasePath);
    db.exec(`
      CREATE TABLE sessions (
        session_id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        custom_name TEXT,
        project_path TEXT,
        jsonl_path TEXT,
        isArchived BOOLEAN DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO sessions (session_id, provider, custom_name)
      VALUES ('legacy-manual', 'codex', 'My existing name');
    `);
    db.close();
  });
});

test('session_names migration preserves custom names as manual overrides', async () => {
  await withIsolatedDatabase(() => {
    const migrated = sessionsDb.getSessionById('legacy-session-name');
    assert.equal(migrated?.custom_name_source, 'manual');

    sessionsDb.updateSessionProviderName('legacy-session-name', 'Provider title');
    assert.equal(sessionsDb.getSessionById('legacy-session-name')?.custom_name, 'Legacy custom name');
  }, (databasePath) => {
    const db = new Database(databasePath);
    db.exec(`
      CREATE TABLE session_names (
        session_id TEXT PRIMARY KEY,
        provider TEXT,
        custom_name TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO session_names (session_id, provider, custom_name)
      VALUES ('legacy-session-name', 'codex', 'Legacy custom name');
    `);
    db.close();
  });
});

test('session_names migration treats blank names as absent during conflict merge', async () => {
  await withIsolatedDatabase(() => {
    const migrated = sessionsDb.getSessionById('existing-provider-name');
    assert.equal(migrated?.custom_name, 'Existing provider name');
    assert.equal(migrated?.custom_name_source, 'provider');
  }, (databasePath) => {
    const db = new Database(databasePath);
    db.exec(`
      CREATE TABLE sessions (
        session_id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        provider_session_id TEXT,
        custom_name TEXT,
        custom_name_source TEXT,
        project_path TEXT,
        jsonl_path TEXT,
        isArchived BOOLEAN DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO sessions (session_id, provider, provider_session_id, custom_name, custom_name_source)
      VALUES ('existing-provider-name', 'codex', 'codex-existing-provider-name', 'Existing provider name', 'provider');
      CREATE TABLE session_names (
        session_id TEXT PRIMARY KEY,
        provider TEXT,
        custom_name TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO session_names (session_id, provider, custom_name)
      VALUES ('existing-provider-name', 'codex', '   ');
    `);
    db.close();
  });
});

test('session archive queries hide archived rows from active project views', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createSession('session-active', 'claude', '/workspace/demo-project', 'Active Session');
    sessionsDb.createSession('session-archived', 'claude', '/workspace/demo-project', 'Archived Session');
    sessionsDb.updateSessionIsArchived('session-archived', true);

    const activeSessions = sessionsDb.getAllSessions();
    const archivedSessions = sessionsDb.getArchivedSessions();
    const activeProjectSessions = sessionsDb.getSessionsByProjectPath('/workspace/demo-project');
    const allProjectSessions = sessionsDb.getSessionsByProjectPathIncludingArchived('/workspace/demo-project');

    assert.deepEqual(activeSessions.map((session) => session.session_id), ['session-active']);
    assert.deepEqual(archivedSessions.map((session) => session.session_id), ['session-archived']);
    assert.deepEqual(activeProjectSessions.map((session) => session.session_id), ['session-active']);
    assert.deepEqual(
      allProjectSessions.map((session) => session.session_id).sort(),
      ['session-active', 'session-archived'],
    );
    assert.equal(sessionsDb.countSessionsByProjectPath('/workspace/demo-project'), 1);
  });
});

test('createSession reactivates archived rows when the session becomes active again', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createSession('session-reused', 'claude', '/workspace/demo-project', 'First Name');
    sessionsDb.updateSessionIsArchived('session-reused', true);

    sessionsDb.createSession('session-reused', 'claude', '/workspace/demo-project', 'Updated Name');

    const activeSessions = sessionsDb.getAllSessions();
    const archivedSessions = sessionsDb.getArchivedSessions();
    const restoredSession = sessionsDb.getSessionById('session-reused');

    assert.equal(activeSessions.length, 1);
    assert.equal(activeSessions[0]?.session_id, 'session-reused');
    assert.equal(activeSessions[0]?.custom_name, 'Updated Name');
    assert.equal(archivedSessions.length, 0);
    assert.equal(restoredSession?.isArchived, 0);
  });
});

test('repository reads normalize SQLite UTC timestamps to ISO strings', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('session-timezone', 'claude', '/workspace/demo-project');

    const row = sessionsDb.getSessionById('session-timezone');
    assert.ok(row?.created_at.endsWith('Z'));
    assert.ok(row?.updated_at.endsWith('Z'));
    assert.match(row?.created_at ?? '', /^\d{4}-\d{2}-\d{2}T/);
    assert.match(row?.updated_at ?? '', /^\d{4}-\d{2}-\d{2}T/);
  });
});
