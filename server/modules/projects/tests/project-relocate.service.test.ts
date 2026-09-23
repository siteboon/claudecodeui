import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, projectsDb, sessionsDb } from '@/modules/database/index.js';
import { relocateProject } from '@/modules/projects/services/project-relocate.service.js';
import { WORKSPACES_ROOT } from '@/shared/utils.js';

type RelocateFixture = {
  workspaceRoot: string;
  oldProjectPath: string;
  newProjectPath: string;
  claudeProjectsRoot: string;
  transcriptPath: string;
  projectId: string;
};

const SESSION_ID = '11111111-1111-4111-8111-111111111111';

function encodeClaudeProjectDirName(projectPath: string): string {
  return projectPath.replace(/[^a-zA-Z0-9]/g, '-');
}

async function withRelocateFixture(
  runTest: (fixture: RelocateFixture) => Promise<void>,
): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  // Not the OS temp dir: this service runs the same `validateWorkspacePath`
  // check a real request does, which refuses `/tmp` and anything outside the
  // configured workspace root.
  const workspaceRoot = await mkdtemp(path.join(WORKSPACES_ROOT, '.cloudcli-relocate-test-'));
  const oldProjectPath = path.join(workspaceRoot, 'alpha');
  const newProjectPath = path.join(workspaceRoot, 'beta');
  const claudeProjectsRoot = path.join(workspaceRoot, 'claude-home', 'projects');
  const transcriptPath = path.join(
    claudeProjectsRoot,
    encodeClaudeProjectDirName(oldProjectPath),
    `${SESSION_ID}.jsonl`,
  );

  closeConnection();
  process.env.DATABASE_PATH = path.join(workspaceRoot, 'auth.db');
  await initializeDatabase();

  await mkdir(oldProjectPath, { recursive: true });
  await writeFile(path.join(oldProjectPath, 'README.md'), '# alpha\n');
  await mkdir(path.dirname(transcriptPath), { recursive: true });
  await writeFile(transcriptPath, `{"sessionId":"${SESSION_ID}","cwd":"${oldProjectPath}"}\n`);

  const created = projectsDb.createProjectPath(oldProjectPath, 'alpha');
  const projectId = created.project?.project_id ?? '';
  sessionsDb.createSession(
    SESSION_ID,
    'claude',
    oldProjectPath,
    'Chat one about readme',
    undefined,
    undefined,
    transcriptPath,
  );

  try {
    await runTest({
      workspaceRoot,
      oldProjectPath,
      newProjectPath,
      claudeProjectsRoot,
      transcriptPath,
      projectId,
    });
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

test('relocateProject moves the project row and its sessions to the renamed folder', async () => {
  await withRelocateFixture(async (fixture) => {
    // The folder is renamed outside the app, exactly as in issue #1165.
    await rename(fixture.oldProjectPath, fixture.newProjectPath);

    const result = await relocateProject(fixture.projectId, fixture.newProjectPath);

    assert.equal(result.path, fixture.newProjectPath);
    assert.equal(result.previousPath, fixture.oldProjectPath);
    assert.equal(result.movedSessionCount, 1);

    assert.equal(
      projectsDb.getProjectPathById(fixture.projectId),
      fixture.newProjectPath,
      'the project row must follow the folder',
    );
    assert.equal(projectsDb.getProjectPath(fixture.oldProjectPath), null);
    assert.equal(
      sessionsDb.getSessionsByProjectPath(fixture.newProjectPath).length,
      1,
      'the session must stay attached to the project it belongs to',
    );
    assert.equal(sessionsDb.getSessionsByProjectPath(fixture.oldProjectPath).length, 0);
  });
});

test('relocateProject moves the Claude transcript into the folder a resume reads from', async () => {
  await withRelocateFixture(async (fixture) => {
    await rename(fixture.oldProjectPath, fixture.newProjectPath);

    const result = await relocateProject(fixture.projectId, fixture.newProjectPath);
    assert.equal(result.movedTranscriptCount, 1);

    const expectedTranscriptPath = path.join(
      fixture.claudeProjectsRoot,
      encodeClaudeProjectDirName(fixture.newProjectPath),
      `${SESSION_ID}.jsonl`,
    );
    assert.equal(sessionsDb.getSessionById(SESSION_ID)?.jsonl_path, expectedTranscriptPath);
    await assert.rejects(() => readFile(fixture.transcriptPath, 'utf8'));

    // The synchronizer reads a session's project path out of the transcript, so
    // a stale `cwd` would drag the session straight back to the old folder.
    const relocatedTranscript = JSON.parse(
      (await readFile(expectedTranscriptPath, 'utf8')).trim(),
    ) as { sessionId: string; cwd: string };
    assert.equal(relocatedTranscript.sessionId, SESSION_ID);
    assert.equal(relocatedTranscript.cwd, fixture.newProjectPath);
  });
});

test('relocateProject rejects a path that no longer exists', async () => {
  await withRelocateFixture(async (fixture) => {
    await assert.rejects(
      () => relocateProject(fixture.projectId, fixture.newProjectPath),
      /Project path not found/,
    );

    assert.equal(projectsDb.getProjectPathById(fixture.projectId), fixture.oldProjectPath);
    assert.equal(sessionsDb.getSessionById(SESSION_ID)?.jsonl_path, fixture.transcriptPath);
  });
});

test('relocateProject rejects a path another project already owns', async () => {
  await withRelocateFixture(async (fixture) => {
    await mkdir(fixture.newProjectPath, { recursive: true });
    projectsDb.createProjectPath(fixture.newProjectPath, 'beta');

    await assert.rejects(
      () => relocateProject(fixture.projectId, fixture.newProjectPath),
      /Another project already uses that path/,
    );

    assert.equal(projectsDb.getProjectPathById(fixture.projectId), fixture.oldProjectPath);
  });
});

test('relocateProject is a no-op when the path is unchanged', async () => {
  await withRelocateFixture(async (fixture) => {
    const result = await relocateProject(fixture.projectId, fixture.oldProjectPath);

    assert.equal(result.movedSessionCount, 0);
    assert.equal(result.movedTranscriptCount, 0);
    assert.equal(sessionsDb.getSessionById(SESSION_ID)?.jsonl_path, fixture.transcriptPath);
  });
});

test('relocateProject leaves a project outside the workspace root alone when its path is unchanged', async () => {
  await withRelocateFixture(async () => {
    // Synchronizers register any CLI cwd, so a project can live where
    // `validateWorkspacePath` would refuse to create one (the OS temp dir is a
    // forbidden system directory, whatever WORKSPACES_ROOT is).
    const outsidePath = await mkdtemp(path.join(os.tmpdir(), 'cloudcli-relocate-outside-'));
    try {
      const outsideProjectId = projectsDb.createProjectPath(outsidePath, 'outside').project?.project_id ?? '';

      const result = await relocateProject(outsideProjectId, outsidePath);

      assert.equal(result.path, outsidePath);
      assert.equal(result.movedSessionCount, 0);
      assert.equal(projectsDb.getProjectPathById(outsideProjectId), outsidePath);
    } finally {
      await rm(outsidePath, { recursive: true, force: true });
    }
  });
});

test('relocateProject rejects an unknown projectId', async () => {
  await withRelocateFixture(async (fixture) => {
    await mkdir(fixture.newProjectPath, { recursive: true });
    await assert.rejects(
      () => relocateProject('not-a-project', fixture.newProjectPath),
      /Unknown projectId/,
    );
  });
});
