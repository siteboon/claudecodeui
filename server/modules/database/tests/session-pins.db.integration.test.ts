import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, getConnection } from '@/modules/database/connection.js';
import { initializeDatabase } from '@/modules/database/init-db.js';
import { runMigrations } from '@/modules/database/migrations.js';
import { sessionPinsDb } from '@/modules/database/repositories/session-pins.db.js';
import { sessionsDb } from '@/modules/database/repositories/sessions.db.js';
import { projectsDb } from '@/modules/database/repositories/projects.db.js';
import { userDb } from '@/modules/database/repositories/users.js';

async function withDatabase(run: (userId: number, otherUserId: number) => void): Promise<void> {
  const previous = process.env.DATABASE_PATH;
  const directory = await mkdtemp(path.join(tmpdir(), 'session-pins-'));
  closeConnection();
  process.env.DATABASE_PATH = path.join(directory, 'auth.db');
  try {
    await initializeDatabase();
    const userId = Number(userDb.createUser('pin-owner', 'unused-test-hash').id);
    const otherUserId = Number(userDb.createUser('other-owner', 'unused-test-hash').id);
    sessionsDb.createAppSession('old-session', 'codex', '/workspace/one', 'Old session');
    sessionsDb.createAppSession('new-session', 'claude', '/workspace/two', 'New session');
    run(userId, otherUserId);
  } finally {
    closeConnection();
    if (previous === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previous;
    await rm(directory, { recursive: true, force: true });
  }
}

test('pin order is persistent, idempotent, user scoped and independent of activity', async () => {
  await withDatabase((userId, otherUserId) => {
    const before = sessionsDb.getSessionById('old-session');
    sessionPinsDb.setPinned(userId, 'old-session', true);
    sessionPinsDb.setPinned(userId, 'new-session', true);
    sessionPinsDb.setPinned(userId, 'old-session', true);
    assert.deepEqual(sessionsDb.getSessionById('old-session'), before, 'pinning must not alter activity or runtime metadata');
    assert.deepEqual(sessionPinsDb.list(otherUserId), []);
    assert.deepEqual(sessionPinsDb.list(userId).map((row) => row.session_id), ['new-session', 'old-session']);
    getConnection().prepare("UPDATE sessions SET updated_at = '2099-01-01T00:00:00Z' WHERE session_id = 'old-session'").run();
    assert.deepEqual(sessionPinsDb.list(userId).map((row) => row.session_id), ['new-session', 'old-session']);

    closeConnection();
    assert.deepEqual(sessionPinsDb.list(userId).map((row) => row.session_id), ['new-session', 'old-session'], 'survives a new connection');
    sessionPinsDb.setPinned(userId, 'old-session', false);
    sessionPinsDb.setPinned(userId, 'old-session', true);
    assert.deepEqual(sessionPinsDb.list(userId).map((row) => row.session_id), ['old-session', 'new-session']);
  });
});

test('archived sessions and projects are hidden, restored pins reappear, deletion cascades', async () => {
  await withDatabase((userId) => {
    sessionPinsDb.setPinned(userId, 'old-session', true);
    sessionPinsDb.setPinned(userId, 'new-session', true);
    sessionsDb.updateSessionIsArchived('old-session', true);
    projectsDb.updateProjectIsArchived('/workspace/two', true);
    assert.deepEqual(sessionPinsDb.list(userId), []);
    sessionsDb.updateSessionIsArchived('old-session', false);
    projectsDb.updateProjectIsArchived('/workspace/two', false);
    assert.deepEqual(sessionPinsDb.list(userId).map((row) => row.session_id), ['new-session', 'old-session']);
    getConnection().prepare('DELETE FROM sessions WHERE session_id = ?').run('new-session');
    assert.deepEqual(sessionPinsDb.list(userId).map((row) => row.session_id), ['old-session']);
    assert.deepEqual(getConnection().prepare("SELECT COUNT(*) AS count FROM session_pins WHERE session_id = 'new-session'").get(), { count: 0 });
    getConnection().prepare('DELETE FROM users WHERE id = ?').run(userId);
    assert.deepEqual(getConnection().prepare('SELECT * FROM session_pins').all(), []);
  });
});

test('migration upgrades the previous schema without changing sessions and preserves existing pins on rerun', async () => {
  await withDatabase((userId) => {
    const db = getConnection();
    db.exec('DROP TABLE session_pins');
    sessionsDb.assignProviderSessionId('old-session', 'native-old-session');
    const before = sessionsDb.getSessionById('old-session');
    runMigrations(db);
    sessionPinsDb.setPinned(userId, 'old-session', true);
    const pins = db.prepare('SELECT * FROM session_pins').all();
    runMigrations(db);
    assert.deepEqual(sessionsDb.getSessionById('old-session'), before);
    assert.deepEqual(db.prepare('SELECT * FROM session_pins').all(), pins);
    assert.deepEqual(db.pragma('foreign_key_check'), []);
  });
});
