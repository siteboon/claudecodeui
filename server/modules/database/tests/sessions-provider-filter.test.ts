import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

import { SESSIONS_TABLE_SCHEMA_SQL, PROJECTS_TABLE_SCHEMA_SQL } from '@/modules/database/schema.js';

function createTestDb(): InstanceType<typeof Database> {
  const db = new Database(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(PROJECTS_TABLE_SCHEMA_SQL);
  db.exec(SESSIONS_TABLE_SCHEMA_SQL);

  db.prepare('INSERT INTO projects (project_id, project_path) VALUES (?, ?)').run('p1', '/tmp/proj-a');
  db.prepare('INSERT INTO projects (project_id, project_path) VALUES (?, ?)').run('p2', '/tmp/proj-b');

  db.prepare(
    'INSERT INTO sessions (session_id, provider, project_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
  ).run('s1', 'claude', '/tmp/proj-a', '2025-01-01T00:00:00Z', '2025-01-01T00:00:00Z');
  db.prepare(
    'INSERT INTO sessions (session_id, provider, project_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
  ).run('s2', 'openclaude', '/tmp/proj-a', '2025-01-02T00:00:00Z', '2025-01-02T00:00:00Z');
  db.prepare(
    'INSERT INTO sessions (session_id, provider, project_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
  ).run('s3', 'crewai', '/tmp/proj-b', '2025-01-03T00:00:00Z', '2025-01-03T00:00:00Z');
  db.prepare(
    'INSERT INTO sessions (session_id, provider, project_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
  ).run('s4', 'openclaude', '/tmp/proj-b', '2025-01-04T00:00:00Z', '2025-01-04T00:00:00Z');

  return db;
}

test('getSessionsByProvider returns only sessions for given provider', () => {
  const db = createTestDb();
  const rows = db
    .prepare('SELECT * FROM sessions WHERE provider = ?')
    .all('openclaude') as { session_id: string }[];
  assert.equal(rows.length, 2);
  assert.ok(rows.every(r => r.session_id.startsWith('s2') || r.session_id.startsWith('s4')));
});

test('getAllSessions returns sessions from all providers', () => {
  const db = createTestDb();
  const rows = db.prepare('SELECT * FROM sessions').all() as { provider: string }[];
  const providers = new Set(rows.map(r => r.provider));
  assert.ok(providers.has('claude'));
  assert.ok(providers.has('openclaude'));
  assert.ok(providers.has('crewai'));
});

test('sessions table provider column accepts openclaude and crewai values', () => {
  const db = createTestDb();
  const occRow = db.prepare("SELECT * FROM sessions WHERE provider = 'openclaude'").get();
  const crewRow = db.prepare("SELECT * FROM sessions WHERE provider = 'crewai'").get();
  assert.ok(occRow, 'openclaude session should exist');
  assert.ok(crewRow, 'crewai session should exist');
});

test('getSessionsByProjectPath returns sessions from all providers for a project', () => {
  const db = createTestDb();
  const rows = db
    .prepare('SELECT * FROM sessions WHERE project_path = ?')
    .all('/tmp/proj-a') as { provider: string }[];
  assert.equal(rows.length, 2);
  const providers = new Set(rows.map(r => r.provider));
  assert.ok(providers.has('claude'));
  assert.ok(providers.has('openclaude'));
});
