import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, getConnection } from '@/modules/database/connection.js';
import { initializeDatabase } from '@/modules/database/init-db.js';
import { runMigrations } from '@/modules/database/migrations.js';

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'drive-letter-merge-'));
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

type ProjectRow = {
  project_id: string;
  project_path: string;
  custom_project_name: string | null;
  isStarred: number;
};

function seedDuplicatePair(): void {
  const db = getConnection();

  // Same directory on Windows, two rows in the table: the pair this migration
  // exists for. The lowercase row carries a star and a custom name, so the
  // test also covers that neither is dropped on the way.
  db.prepare(
    'INSERT INTO projects (project_id, project_path, custom_project_name, isStarred, isArchived) VALUES (?, ?, ?, ?, 0)',
  ).run('project-upper', 'A:\\work', 'work', 0);
  db.prepare(
    'INSERT INTO projects (project_id, project_path, custom_project_name, isStarred, isArchived) VALUES (?, ?, ?, ?, 0)',
  ).run('project-lower', 'a:\\work', 'Umbenannt', 1);
  // A lowercase path with no uppercase counterpart: nothing to merge into, so
  // the row itself has to be renamed instead of dropped.
  db.prepare(
    'INSERT INTO projects (project_id, project_path, custom_project_name, isStarred, isArchived) VALUES (?, ?, NULL, 0, 0)',
  ).run('project-solo', 'b:\\solo');

  const insertSession = db.prepare(
    'INSERT INTO sessions (session_id, provider, project_path) VALUES (?, ?, ?)',
  );
  insertSession.run('session-upper', 'claude', 'A:\\work');
  insertSession.run('session-lower', 'claude', 'a:\\work');
  insertSession.run('session-solo', 'claude', 'b:\\solo');
}

test('runMigrations merges projects that differ only in drive letter case', async () => {
  await withIsolatedDatabase(() => {
    seedDuplicatePair();
    runMigrations(getConnection());

    const db = getConnection();
    const projects = db
      .prepare('SELECT project_id, project_path, custom_project_name, isStarred FROM projects ORDER BY project_path')
      .all() as ProjectRow[];

    assert.deepEqual(
      projects.map((project) => project.project_path),
      ['A:\\work', 'B:\\solo'],
    );

    const merged = projects.find((project) => project.project_path === 'A:\\work');
    assert.equal(merged?.project_id, 'project-upper', 'the surviving row is the uppercase one');
    assert.equal(merged?.isStarred, 1, 'a star on the duplicate is inherited');
    assert.equal(merged?.custom_project_name, 'work', 'an existing custom name is not overwritten');

    const renamed = projects.find((project) => project.project_path === 'B:\\solo');
    assert.equal(renamed?.project_id, 'project-solo', 'a lone lowercase row keeps its id');
  });
});

test('runMigrations repoints sessions of a merged project instead of orphaning them', async () => {
  await withIsolatedDatabase(() => {
    seedDuplicatePair();
    runMigrations(getConnection());

    const db = getConnection();
    const sessions = db
      .prepare('SELECT session_id, project_path FROM sessions ORDER BY session_id')
      .all() as { session_id: string; project_path: string | null }[];

    assert.deepEqual(sessions, [
      { session_id: 'session-lower', project_path: 'A:\\work' },
      { session_id: 'session-solo', project_path: 'B:\\solo' },
      { session_id: 'session-upper', project_path: 'A:\\work' },
    ]);
  });
});

test('runMigrations keeps a merged project active when the duplicate was in use', async () => {
  await withIsolatedDatabase(() => {
    const db = getConnection();

    // The uppercase row was archived at some point; the lowercase one is the
    // project actually being worked in. All sessions end up on the surviving
    // row, so keeping it archived would hide a project in daily use.
    db.prepare(
      'INSERT INTO projects (project_id, project_path, custom_project_name, isStarred, isArchived) VALUES (?, ?, NULL, 0, 1)',
    ).run('project-archived', 'A:\\work');
    db.prepare(
      'INSERT INTO projects (project_id, project_path, custom_project_name, isStarred, isArchived) VALUES (?, ?, NULL, 0, 0)',
    ).run('project-active', 'a:\\work');
    db.prepare('INSERT INTO sessions (session_id, provider, project_path) VALUES (?, ?, ?)').run(
      'session-active',
      'claude',
      'a:\\work',
    );

    runMigrations(db);

    const merged = db
      .prepare('SELECT project_path, isArchived FROM projects')
      .all() as { project_path: string; isArchived: number }[];
    assert.deepEqual(merged, [{ project_path: 'A:\\work', isArchived: 0 }]);
  });
});

test('runMigrations keeps a merged project archived when both rows were archived', async () => {
  await withIsolatedDatabase(() => {
    const db = getConnection();

    db.prepare(
      'INSERT INTO projects (project_id, project_path, custom_project_name, isStarred, isArchived) VALUES (?, ?, NULL, 0, 1)',
    ).run('project-archived-upper', 'A:\\gone');
    db.prepare(
      'INSERT INTO projects (project_id, project_path, custom_project_name, isStarred, isArchived) VALUES (?, ?, NULL, 0, 1)',
    ).run('project-archived-lower', 'a:\\gone');

    runMigrations(db);

    const merged = db
      .prepare('SELECT project_path, isArchived FROM projects')
      .all() as { project_path: string; isArchived: number }[];
    assert.deepEqual(merged, [{ project_path: 'A:\\gone', isArchived: 1 }]);
  });
});

test('runMigrations leaves a database without lowercase drive letters alone', async () => {
  await withIsolatedDatabase(() => {
    const db = getConnection();
    db.prepare(
      'INSERT INTO projects (project_id, project_path, custom_project_name, isStarred, isArchived) VALUES (?, ?, NULL, 0, 0)',
    ).run('project-plain', 'C:\\Users\\Someone\\project');
    db.prepare('INSERT INTO sessions (session_id, provider, project_path) VALUES (?, ?, ?)').run(
      'session-plain',
      'claude',
      'C:\\Users\\Someone\\project',
    );

    runMigrations(db);

    const paths = db
      .prepare('SELECT project_path FROM projects')
      .all() as { project_path: string }[];
    assert.deepEqual(paths, [{ project_path: 'C:\\Users\\Someone\\project' }]);
  });
});
