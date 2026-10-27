import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, projectsDb, sessionsDb } from '@/modules/database/index.js';
import { relocateProject } from '@/modules/projects/services/project-relocate.service.js';
import { providerRuntimeService, sessionsService } from '@/modules/providers/index.js';
import { chatRunRegistry } from '@/modules/websocket/index.js';
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
  folderNames: { oldName: string; newName: string } = { oldName: 'alpha', newName: 'beta' },
): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  // Not the OS temp dir: this service runs the same `validateWorkspacePath`
  // check a real request does, which refuses `/tmp` and anything outside the
  // configured workspace root.
  const workspaceRoot = await mkdtemp(path.join(WORKSPACES_ROOT, '.cloudcli-relocate-test-'));
  const oldProjectPath = path.join(workspaceRoot, folderNames.oldName);
  const newProjectPath = path.join(workspaceRoot, folderNames.newName);
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

test('relocateProject moves the session folder that holds subagent transcripts', async () => {
  await withRelocateFixture(async (fixture) => {
    const oldSubagentPath = path.join(
      path.dirname(fixture.transcriptPath),
      SESSION_ID,
      'subagents',
      'agent-a1.jsonl',
    );
    await mkdir(path.dirname(oldSubagentPath), { recursive: true });
    await writeFile(oldSubagentPath, '{"type":"assistant"}\n');
    await rename(fixture.oldProjectPath, fixture.newProjectPath);

    await relocateProject(fixture.projectId, fixture.newProjectPath);

    // The history reader looks for `<id>/subagents/` beside the transcript, so
    // anything left behind drops out of the session's history.
    const newSubagentPath = path.join(
      fixture.claudeProjectsRoot,
      encodeClaudeProjectDirName(fixture.newProjectPath),
      SESSION_ID,
      'subagents',
      'agent-a1.jsonl',
    );
    assert.equal(await readFile(newSubagentPath, 'utf8'), '{"type":"assistant"}\n');
    await assert.rejects(() => readFile(oldSubagentPath, 'utf8'));
  });
});

test('relocateProject rewrites the cwd in place when both folders share a Claude transcript folder', async () => {
  await withRelocateFixture(
    async (fixture) => {
      assert.equal(
        encodeClaudeProjectDirName(fixture.oldProjectPath),
        encodeClaudeProjectDirName(fixture.newProjectPath),
        'the fixture must collide for this test to mean anything',
      );
      await rename(fixture.oldProjectPath, fixture.newProjectPath);

      const result = await relocateProject(fixture.projectId, fixture.newProjectPath);

      assert.equal(result.movedTranscriptCount, 1);
      assert.equal(sessionsDb.getSessionById(SESSION_ID)?.jsonl_path, fixture.transcriptPath);
      // Left stale, the synchronizer would drag the session back to the old
      // folder the next time the chat is used.
      const transcript = JSON.parse((await readFile(fixture.transcriptPath, 'utf8')).trim()) as { cwd: string };
      assert.equal(transcript.cwd, fixture.newProjectPath);
      assert.deepEqual(
        await readdir(path.dirname(fixture.transcriptPath)),
        [`${SESSION_ID}.jsonl`],
        'the rewrite must not leave a temporary file behind',
      );
    },
    { oldName: 'a b', newName: 'a_b' },
  );
});

test('relocateProject survives the watcher indexing a moved transcript mid-relocation', async (t) => {
  await withRelocateFixture(async (fixture) => {
    await rename(fixture.oldProjectPath, fixture.newProjectPath);
    const relocateTranscripts = sessionsService.relocateProjectTranscripts.bind(sessionsService);
    t.mock.method(sessionsService, 'relocateProjectTranscripts', async (
      input: Parameters<typeof sessionsService.relocateProjectTranscripts>[0],
    ) => {
      const moved = await relocateTranscripts(input);
      // What the session watcher does when it picks up the copy, whose cwd
      // already names the new folder, before the relocation has finished.
      sessionsDb.createSession(SESSION_ID, 'claude', fixture.newProjectPath, undefined, undefined, undefined, moved[0].jsonlPath);
      return moved;
    });

    await relocateProject(fixture.projectId, fixture.newProjectPath);

    const projectAtNewPath = projectsDb.getProjectPath(fixture.newProjectPath);
    assert.equal(projectAtNewPath?.project_id, fixture.projectId, 'the watcher must not split off a second project');
    assert.equal(projectAtNewPath?.custom_project_name, 'alpha');
    assert.equal(sessionsDb.getSessionById(SESSION_ID)?.project_path, fixture.newProjectPath);
  });
});

test('relocateProject puts the rows back when the transcripts cannot be moved', async (t) => {
  await withRelocateFixture(async (fixture) => {
    await rename(fixture.oldProjectPath, fixture.newProjectPath);
    t.mock.method(sessionsService, 'relocateProjectTranscripts', async () => {
      // The watcher indexed a copy before the move failed and was undone.
      sessionsDb.createSession(SESSION_ID, 'claude', fixture.newProjectPath, undefined, undefined, undefined, '/gone/copy.jsonl');
      throw new Error('disk full');
    });

    await assert.rejects(() => relocateProject(fixture.projectId, fixture.newProjectPath), /disk full/);

    assert.equal(projectsDb.getProjectPathById(fixture.projectId), fixture.oldProjectPath);
    assert.equal(projectsDb.getProjectPath(fixture.newProjectPath), null);
    const session = sessionsDb.getSessionById(SESSION_ID);
    assert.equal(session?.project_path, fixture.oldProjectPath);
    assert.equal(session?.jsonl_path, fixture.transcriptPath);
  });
});

test('relocateProject moves the transcripts back when their new paths cannot be saved', async (t) => {
  await withRelocateFixture(async (fixture) => {
    await rename(fixture.oldProjectPath, fixture.newProjectPath);
    const realUpdate = sessionsDb.updateSessionTranscriptPath.bind(sessionsDb);
    let failed = false;
    t.mock.method(sessionsDb, 'updateSessionTranscriptPath', (sessionId: string, jsonlPath: string) => {
      if (!failed) {
        failed = true;
        throw new Error('database is locked');
      }
      return realUpdate(sessionId, jsonlPath);
    });

    await assert.rejects(() => relocateProject(fixture.projectId, fixture.newProjectPath), /database is locked/);

    // Rows and files agree again: both describe the old folder.
    assert.equal(projectsDb.getProjectPathById(fixture.projectId), fixture.oldProjectPath);
    assert.equal(sessionsDb.getSessionById(SESSION_ID)?.jsonl_path, fixture.transcriptPath);
    assert.equal(JSON.parse(await readFile(fixture.transcriptPath, 'utf8')).cwd, fixture.oldProjectPath);
    await assert.rejects(() => readFile(
      path.join(fixture.claudeProjectsRoot, encodeClaudeProjectDirName(fixture.newProjectPath), `${SESSION_ID}.jsonl`),
      'utf8',
    ));
  });
});

test('relocateProject keeps the project with its transcripts when they cannot be moved back', async (t) => {
  await withRelocateFixture(async (fixture) => {
    await rename(fixture.oldProjectPath, fixture.newProjectPath);
    t.mock.method(sessionsDb, 'updateSessionTranscriptPath', () => {
      throw new Error('database is locked');
    });
    const realRelocate = sessionsService.relocateProjectTranscripts.bind(sessionsService);
    let calls = 0;
    t.mock.method(sessionsService, 'relocateProjectTranscripts', async (input: Parameters<typeof realRelocate>[0]) => {
      calls += 1;
      if (calls > 1) {
        throw new Error('disk full');
      }
      return realRelocate(input);
    });
    const consoleError = t.mock.method(console, 'error', () => {});

    await assert.rejects(() => relocateProject(fixture.projectId, fixture.newProjectPath), /database is locked/);

    assert.equal(consoleError.mock.callCount(), 1);
    assert.equal(projectsDb.getProjectPathById(fixture.projectId), fixture.newProjectPath);
    const movedPath = path.join(
      fixture.claudeProjectsRoot,
      encodeClaudeProjectDirName(fixture.newProjectPath),
      `${SESSION_ID}.jsonl`,
    );
    assert.equal(JSON.parse(await readFile(movedPath, 'utf8')).cwd, fixture.newProjectPath);
  });
});

test('relocateProject refuses while a conversation in the project is running', async (t) => {
  for (const busy of ['run', 'background work'] as const) {
    await withRelocateFixture(async (fixture) => {
      await rename(fixture.oldProjectPath, fixture.newProjectPath);
      const isSession = (sessionId: string) => sessionId === SESSION_ID;
      t.mock.method(chatRunRegistry, 'isProcessing', (sessionId: string) => busy === 'run' && isSession(sessionId));
      t.mock.method(providerRuntimeService, 'hasBackgroundWork', (sessionId: string) => busy === 'background work' && isSession(sessionId));

      await assert.rejects(
        () => relocateProject(fixture.projectId, fixture.newProjectPath),
        { statusCode: 409, code: 'PROJECT_SESSION_RUNNING' },
      );

      assert.equal(projectsDb.getProjectPathById(fixture.projectId), fixture.oldProjectPath);
      assert.equal(JSON.parse(await readFile(fixture.transcriptPath, 'utf8')).cwd, fixture.oldProjectPath);
      t.mock.restoreAll();
    });
  }
});

test('relocateProject refuses a second move of the same project while one is under way', async () => {
  await withRelocateFixture(async (fixture) => {
    await rename(fixture.oldProjectPath, fixture.newProjectPath);

    // A double Enter in the editor: both requests arrive before either finishes.
    const first = relocateProject(fixture.projectId, fixture.newProjectPath);
    await assert.rejects(
      () => relocateProject(fixture.projectId, fixture.newProjectPath),
      { statusCode: 409, code: 'PROJECT_RELOCATION_IN_PROGRESS' },
    );

    assert.equal((await first).path, fixture.newProjectPath);
    assert.equal(projectsDb.getProjectPathById(fixture.projectId), fixture.newProjectPath);
    // The guard is released once the move is over.
    assert.equal((await relocateProject(fixture.projectId, fixture.newProjectPath)).movedSessionCount, 0);
  });
});

test('relocateProject reports a transcript already in the new folder as a conflict', async () => {
  await withRelocateFixture(async (fixture) => {
    await rename(fixture.oldProjectPath, fixture.newProjectPath);
    const existingCopyPath = path.join(
      fixture.claudeProjectsRoot,
      encodeClaudeProjectDirName(fixture.newProjectPath),
      `${SESSION_ID}.jsonl`,
    );
    await mkdir(path.dirname(existingCopyPath), { recursive: true });
    await writeFile(existingCopyPath, '{"copy":true}\n');

    await assert.rejects(
      () => relocateProject(fixture.projectId, fixture.newProjectPath),
      { statusCode: 409, code: 'TRANSCRIPT_ALREADY_EXISTS' },
    );

    assert.equal(projectsDb.getProjectPathById(fixture.projectId), fixture.oldProjectPath);
    assert.equal(sessionsDb.getSessionById(SESSION_ID)?.jsonl_path, fixture.transcriptPath);
    assert.equal(await readFile(existingCopyPath, 'utf8'), '{"copy":true}\n');
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
