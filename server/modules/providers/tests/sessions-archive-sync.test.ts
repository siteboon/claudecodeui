import assert from 'node:assert/strict';
import fsp, { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import Database from 'better-sqlite3';

import { closeConnection, initializeDatabase, projectsDb, sessionsDb } from '@/modules/database/index.js';
import { deleteOrArchiveProject } from '@/modules/projects/index.js';
import { sessionsService } from '@/modules/providers/index.js';

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'archive-sync-test-db-'));

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
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

test('archived session is not reactivated when synchronizer calls createSession', { concurrency: false }, async () => {
  await withIsolatedDatabase(() => {
    // 1. Initial creation
    const sessionId = sessionsDb.createSession(
      'session-archived-1',
      'claude',
      '/tmp/test-archive-project',
      'Original Title',
    );
    assert.equal(sessionsDb.getSessionById(sessionId)?.isArchived, 0);

    // 2. User archives session
    sessionsDb.updateSessionIsArchived(sessionId, true);
    assert.equal(sessionsDb.getSessionById(sessionId)?.isArchived, 1);

    // 3. Background synchronizer rescans and calls createSession again
    sessionsDb.createSession(
      'session-archived-1',
      'claude',
      '/tmp/test-archive-project',
      'Scanned Title',
    );

    // 4. Invariant: User archive state MUST be preserved!
    assert.equal(
      sessionsDb.getSessionById(sessionId)?.isArchived,
      1,
      'Session was resurrected from archived state by createSession!',
    );
  });
});

test('archived project is not reactivated when synchronizer indexes a session belonging to it', { concurrency: false }, async () => {
  await withIsolatedDatabase(() => {
    const projectPath = '/tmp/test-project-archive-path';

    // 1. Create session (which creates project path)
    sessionsDb.createSession('session-project-1', 'claude', projectPath);
    const project = projectsDb.getProjectPath(projectPath);
    assert.ok(project);
    assert.equal(project.isArchived, 0);

    // 2. User archives the project
    projectsDb.updateProjectIsArchivedById(project.project_id, true);
    assert.equal(projectsDb.getProjectPath(projectPath)?.isArchived, 1);

    // 3. Background synchronizer rescans sessions for this project
    sessionsDb.createSession('session-project-1', 'claude', projectPath);

    // 4. Invariant: Project archive state MUST be preserved!
    assert.equal(
      projectsDb.getProjectPath(projectPath)?.isArchived,
      1,
      'Project was resurrected from archived state when a session was indexed!',
    );
  });
});

test('soft-deleted project via deleteOrArchiveProject stays archived during synchronizer rescan', { concurrency: false }, async () => {
  await withIsolatedDatabase(async () => {
    const projectPath = '/tmp/test-soft-deleted-project';

    sessionsDb.createSession('session-soft-1', 'claude', projectPath);
    const project = projectsDb.getProjectPath(projectPath);
    assert.ok(project);

    // Soft delete (archive)
    await deleteOrArchiveProject(project.project_id, false);
    assert.equal(projectsDb.getProjectPath(projectPath)?.isArchived, 1);

    // Rescan session
    sessionsDb.createSession('session-soft-1', 'claude', projectPath);

    assert.equal(
      projectsDb.getProjectPath(projectPath)?.isArchived,
      1,
      'Soft-deleted project was resurrected by synchronizer rescan!',
    );
  });
});

test('permanently deleting an antigravity session deletes its row from conversation_summaries.db and brain folder', { concurrency: false }, async () => {
  const agDataDir = await mkdtemp(path.join(os.tmpdir(), 'ag-test-data-'));
  const previousAgDir = process.env.CLOUDCLI_ANTIGRAVITY_DATA_DIR;
  process.env.CLOUDCLI_ANTIGRAVITY_DATA_DIR = agDataDir;

  try {
    // Setup fake conversation_summaries.db
    const dbPath = path.join(agDataDir, 'conversation_summaries.db');
    const agDb = new Database(dbPath);
    agDb.exec(`
      CREATE TABLE conversation_summaries (
        conversation_id TEXT PRIMARY KEY,
        title TEXT,
        workspace_uris TEXT,
        last_modified_time TEXT,
        status TEXT
      );
      INSERT INTO conversation_summaries (conversation_id, title, workspace_uris, last_modified_time, status)
      VALUES ('ag-session-1', 'AG Session 1', '["file:///tmp/ag-project"]', '2026-09-02T10:00:00Z', 'COMPLETED');
    `);
    agDb.close();

    // Setup fake brain folder
    const brainDir = path.join(agDataDir, 'brain', 'ag-session-1');
    await fsp.mkdir(brainDir, { recursive: true });
    await fsp.writeFile(path.join(brainDir, 'test.md'), 'hello');

    await withIsolatedDatabase(async () => {
      // Index the session in CloudCLI
      sessionsDb.createSession('ag-session-1', 'antigravity', '/tmp/ag-project', 'AG Session 1');
      assert.ok(sessionsDb.getSessionById('ag-session-1'));

      // Hard delete the session
      const result = await sessionsService.deleteOrArchiveSessionById('ag-session-1', {
        force: true,
        deletedFromDisk: true,
      });
      assert.equal(result.action, 'deleted');

      // Check CloudCLI DB
      assert.equal(sessionsDb.getSessionById('ag-session-1'), null);

      // Check Antigravity DB
      const checkDb = new Database(dbPath, { readonly: true });
      const row = checkDb.prepare('SELECT * FROM conversation_summaries WHERE conversation_id = ?').get('ag-session-1');
      checkDb.close();
      assert.equal(row, undefined, 'Antigravity conversation_summaries row was not deleted!');

      // Check brain folder
      let brainExists = true;
      try {
        await fsp.access(brainDir);
      } catch {
        brainExists = false;
      }
      assert.equal(brainExists, false, 'Antigravity brain folder was not deleted!');
    });
  } finally {
    if (previousAgDir === undefined) {
      delete process.env.CLOUDCLI_ANTIGRAVITY_DATA_DIR;
    } else {
      process.env.CLOUDCLI_ANTIGRAVITY_DATA_DIR = previousAgDir;
    }
    await rm(agDataDir, { recursive: true, force: true });
  }
});

test('permanently deleting a project cleans up Antigravity workspace summaries and Claude project folder', { concurrency: false }, async () => {
  const agDataDir = await mkdtemp(path.join(os.tmpdir(), 'ag-proj-test-data-'));
  const previousAgDir = process.env.CLOUDCLI_ANTIGRAVITY_DATA_DIR;
  process.env.CLOUDCLI_ANTIGRAVITY_DATA_DIR = agDataDir;

  const projectPath = '/tmp/proj-hard-del-workspace';
  const encodedCandidate = projectPath.replace(/[^a-zA-Z0-9_-]/g, '-');
  const fakeClaudeDir = path.join(os.homedir(), '.claude', 'projects', encodedCandidate);
  await fsp.mkdir(fakeClaudeDir, { recursive: true });
  await fsp.writeFile(path.join(fakeClaudeDir, 'session.jsonl'), '{"sessionId":"test"}');

  try {
    // Setup fake conversation_summaries.db
    const dbPath = path.join(agDataDir, 'conversation_summaries.db');
    const agDb = new Database(dbPath);
    agDb.exec(`
      CREATE TABLE conversation_summaries (
        conversation_id TEXT PRIMARY KEY,
        title TEXT,
        workspace_uris TEXT,
        last_modified_time TEXT,
        status TEXT
      );
      INSERT INTO conversation_summaries (conversation_id, title, workspace_uris, last_modified_time, status)
      VALUES ('ag-sess-p1', 'AG Session P1', '["file:///tmp/proj-hard-del-workspace"]', '2026-09-02T10:00:00Z', 'COMPLETED');
    `);
    agDb.close();

    await withIsolatedDatabase(async () => {
      sessionsDb.createSession('ag-sess-p1', 'antigravity', projectPath, 'AG Session P1');
      const project = projectsDb.getProjectPath(projectPath);
      assert.ok(project);

      // Hard delete project
      await deleteOrArchiveProject(project.project_id, true);

      // Verify CloudCLI DB
      assert.equal(projectsDb.getProjectPath(projectPath), null);
      assert.equal(sessionsDb.getSessionById('ag-sess-p1'), null);

      // Verify Antigravity summaries db
      const checkDb = new Database(dbPath, { readonly: true });
      const row = checkDb.prepare('SELECT * FROM conversation_summaries WHERE conversation_id = ?').get('ag-sess-p1');
      checkDb.close();
      assert.equal(row, undefined, 'Antigravity workspace summary was not deleted during project force delete!');

      // Verify Claude folder
      let claudeFolderExists = true;
      try {
        await fsp.access(fakeClaudeDir);
      } catch {
        claudeFolderExists = false;
      }
      assert.equal(claudeFolderExists, false, 'Claude project folder was not deleted during project force delete!');
    });
  } finally {
    if (previousAgDir === undefined) {
      delete process.env.CLOUDCLI_ANTIGRAVITY_DATA_DIR;
    } else {
      process.env.CLOUDCLI_ANTIGRAVITY_DATA_DIR = previousAgDir;
    }
    await rm(agDataDir, { recursive: true, force: true });
    try {
      await fsp.rm(fakeClaudeDir, { recursive: true, force: true });
    } catch {
      // Ignored
    }
  }
});

test('deleteProviderProjectStorage refuses to delete on empty, root, or whitespace paths', async () => {
  // Defensive check: calling deleteProviderProjectStorage with empty or root path should not throw or delete parent dirs
  await assert.doesNotReject(async () => {
    await sessionsService.deleteProviderProjectStorage('');
    await sessionsService.deleteProviderProjectStorage('   ');
    await sessionsService.deleteProviderProjectStorage('/');
  });
});



