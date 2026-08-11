import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection } from '@/modules/database/connection.js';
import { initializeDatabase } from '@/modules/database/init-db.js';
import { projectsDb } from '@/modules/database/repositories/projects.db.js';
import { sessionsDb } from '@/modules/database/repositories/sessions.db.js';

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'sessions-db-'));
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

test('recent sessions are globally ordered, paginated, and limited to visible conversations', async () => {
  await withIsolatedDatabase(() => {
    const fixtures: Array<Parameters<typeof sessionsDb.createSession>> = [
      ['session-oldest', 'claude', '/workspace/project-a', 'Oldest', '2026-07-18T09:00:00.000Z', '2026-07-18T10:00:00.000Z'],
      ['session-newest', 'codex', '/workspace/project-b', 'Newest', '2026-07-18T11:00:00.000Z', '2026-07-18T12:00:00.900Z'],
      ['session-same-second', 'claude', '/workspace/project-a', 'Same second, slightly older', '2026-07-18T12:00:00.000Z', '2026-07-18T12:00:00.100Z'],
      ['session-middle', 'claude', '/workspace/project-a', 'Middle', '2026-07-18T10:00:00.000Z', '2026-07-18T11:00:00.000Z'],
      ['session-archived', 'claude', '/workspace/project-a', 'Archived session', '2026-07-18T13:00:00.000Z', '2026-07-18T13:00:00.000Z'],
      ['session-hidden-project', 'claude', '/workspace/project-hidden', 'Archived project session', '2026-07-18T14:00:00.000Z', '2026-07-18T14:00:00.000Z'],
    ];
    fixtures.forEach((fixture) => sessionsDb.createSession(...fixture));

    sessionsDb.updateSessionIsArchived('session-archived', true);
    projectsDb.updateProjectIsArchived('/workspace/project-hidden', true);

    const firstPage = sessionsDb.getRecentSessionsPage(2, 0);
    const secondPage = sessionsDb.getRecentSessionsPage(2, 2);

    assert.equal(firstPage.total, 4);
    assert.deepEqual(
      firstPage.sessions.map((session) => session.session_id),
      ['session-newest', 'session-same-second'],
    );
    assert.equal(secondPage.total, 4);
    assert.deepEqual(
      secondPage.sessions.map((session) => session.session_id),
      ['session-middle', 'session-oldest'],
    );
  });
});
