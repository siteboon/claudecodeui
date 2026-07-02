import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, projectsDb, sessionsDb } from '@/modules/database/index.js';
import { ClaudeSessionSynchronizer } from '@/modules/providers/index.js';
import { deleteOrArchiveProject } from '@/modules/projects/services/project-delete.service.js';

const PROJECT_CWD = '/Users/tester/dev/adoring-driscoll';
const SESSION_ID = '11111111-2222-3333-4444-555555555555';

async function withEnv(runTest: (home: string) => Promise<void>): Promise<void> {
  const prevDb = process.env.DATABASE_PATH;
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'project-delete-'));
  const fakeHome = path.join(tempDir, 'home');
  const origHomedir = os.homedir;
  (os as unknown as { homedir: () => string }).homedir = () => fakeHome;

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDir, 'auth.db');
  await initializeDatabase();
  try {
    await runTest(fakeHome);
  } finally {
    (os as unknown as { homedir: () => string }).homedir = origHomedir;
    closeConnection();
    if (prevDb === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = prevDb;
    await rm(tempDir, { recursive: true, force: true });
  }
}

function claudeProjectDir(home: string): string {
  const encoded = PROJECT_CWD.replace(/[^a-zA-Z0-9-]/g, '-');
  return path.join(home, '.claude', 'projects', encoded);
}

async function writeTranscript(home: string): Promise<string> {
  const dir = claudeProjectDir(home);
  await mkdir(dir, { recursive: true });
  const jsonlPath = path.join(dir, `${SESSION_ID}.jsonl`);
  await writeFile(
    jsonlPath,
    JSON.stringify({ sessionId: SESSION_ID, cwd: PROJECT_CWD, type: 'user' }) + '\n',
    'utf8',
  );
  return jsonlPath;
}

test('force delete of a synchronizer-indexed project stays deleted after a re-sync', async () => {
  await withEnv(async (home) => {
    const jsonlPath = await writeTranscript(home);
    await new ClaudeSessionSynchronizer().synchronizeFile(jsonlPath);

    const projectId = projectsDb.getProjectPaths()[0].project_id;
    await deleteOrArchiveProject(projectId, true);

    await new ClaudeSessionSynchronizer().synchronize(undefined); // simulate reload -> GET /api/projects
    assert.equal(projectsDb.getProjectPaths().length, 0, 'project should stay deleted');
  });
});

test('force delete removes the transcript of an app-created session (jsonl_path NULL) so it cannot resurrect', async () => {
  await withEnv(async (home) => {
    const jsonlPath = await writeTranscript(home);
    // App registers the session up-front with a NULL jsonl_path (user starts a conversation in the UI).
    sessionsDb.createAppSession(SESSION_ID, 'claude', PROJECT_CWD);

    const projectId = projectsDb.getProjectPaths()[0].project_id;
    await deleteOrArchiveProject(projectId, true);

    // The on-disk transcript (and its directory) must be gone, not just the DB rows.
    assert.equal(existsSync(jsonlPath), false, 'transcript file should be deleted');
    assert.equal(existsSync(claudeProjectDir(home)), false, 'project transcript dir should be deleted');

    // A reload re-runs the synchronizer; with the files gone the project must not come back.
    await new ClaudeSessionSynchronizer().synchronize(undefined);
    assert.equal(projectsDb.getProjectPaths().length, 0, 'project must not resurrect after reload');
  });
});

test('force delete never removes files outside the Claude projects root', async () => {
  await withEnv(async (home) => {
    // A malformed/relative project_path must not let directory removal escape the root.
    const outside = path.join(home, 'precious');
    await mkdir(outside, { recursive: true });
    await writeFile(path.join(outside, 'keep.txt'), 'keep', 'utf8');

    const created = projectsDb.createProjectPath('../../../precious');
    await deleteOrArchiveProject(created.project!.project_id, true);

    assert.equal(existsSync(path.join(outside, 'keep.txt')), true, 'unrelated files must be preserved');
  });
});

test('re-indexing a transcript does NOT un-archive a project the user archived', async () => {
  await withEnv(async (home) => {
    const jsonlPath = await writeTranscript(home);
    await new ClaudeSessionSynchronizer().synchronizeFile(jsonlPath);

    const projectId = projectsDb.getProjectPaths()[0].project_id;
    // Archive (soft delete).
    await deleteOrArchiveProject(projectId, false);
    assert.equal(projectsDb.getProjectPaths().length, 0, 'archived project hidden from active list');

    // The file watcher re-indexes the still-present transcript (a `change` event)...
    await new ClaudeSessionSynchronizer().synchronizeFile(jsonlPath);

    // ...but the project must remain archived, not silently reappear.
    assert.equal(projectsDb.getProjectPaths().length, 0, 'still hidden after re-index');
    assert.equal(projectsDb.getArchivedProjectPaths().length, 1, 'still archived after re-index');
  });
});
