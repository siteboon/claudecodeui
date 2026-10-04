import assert from 'node:assert/strict';
import { appendFile, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  closeConnection,
  initializeDatabase,
  projectsDb,
  scanStateDb,
  sessionsDb,
} from '@/modules/database/index.js';

// Each provider synchronizer resolves `os.homedir()` when the registry module is
// first imported, so HOME has to point at an empty fixture home *before* that
// import runs. Otherwise the sync pass walks the developer's real ~/.claude.
const fixtureHome = await mkdtemp(path.join(os.tmpdir(), 'session-incremental-home-'));
const previousHome = process.env.HOME;
const previousUserProfile = process.env.USERPROFILE;
process.env.HOME = fixtureHome;
process.env.USERPROFILE = fixtureHome;

const { sessionSynchronizerService } = await import(
  '@/modules/providers/services/session-synchronizer.service.js'
);

process.on('exit', () => {
  if (previousHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = previousHome;
  }
  if (previousUserProfile === undefined) {
    delete process.env.USERPROFILE;
  } else {
    process.env.USERPROFILE = previousUserProfile;
  }
});

async function withIsolatedDatabase(runTest: () => Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'session-incremental-db-'));

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
    for (const providerHome of ['.claude', '.codex', '.cursor']) {
      await rm(path.join(fixtureHome, providerHome), { recursive: true, force: true });
    }
  }
}

/**
 * Waits until the wall clock is in a later whole second than `time`.
 *
 * scan_state stores its cursor with whole-second precision, so only a scan
 * that starts after this point is guaranteed to leave the cursor past `time`.
 */
async function waitUntilCursorCanPass(time: Date): Promise<void> {
  const nextWholeSecond = (Math.floor(time.getTime() / 1000) + 1) * 1000;
  const delay = nextWholeSecond - Date.now() + 20;
  if (delay > 0) {
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}

function claudeRecord(sessionId: string, cwd: string): string {
  return `${JSON.stringify({
    sessionId,
    cwd,
    type: 'user',
    message: { role: 'user', content: 'hello' },
    timestamp: '2026-07-14T12:00:00.000Z',
  })}\n`;
}

test('a transcript that was still empty when first scanned is indexed once a record is appended', async () => {
  await withIsolatedDatabase(async () => {
    const sessionId = '7f0e7d4e-0000-4000-8000-000000000001';
    const projectPath = '/tmp/indexer-repro';

    // Claude Code creates the project directory and the transcript before the
    // first `cwd`-bearing record lands.
    const projectDirectory = path.join(fixtureHome, '.claude', 'projects', '-tmp-indexer-repro');
    await mkdir(projectDirectory, { recursive: true });
    const transcriptPath = path.join(projectDirectory, `${sessionId}.jsonl`);
    await writeFile(transcriptPath, '');
    const { birthtime } = await stat(transcriptPath);

    // A projects refetch scans while the file is still empty: nothing to index,
    // yet the cursor moves past the file's creation time.
    await waitUntilCursorCanPass(birthtime);
    const emptyScan = await sessionSynchronizerService.synchronizeSessions();
    assert.deepEqual(emptyScan.failures, []);
    assert.equal(emptyScan.processedByProvider.claude, 0);
    assert.equal(sessionsDb.getSessionById(sessionId), null);
    const cursor = scanStateDb.getLastScannedAt();
    assert.ok(cursor && cursor > birthtime, 'the cursor must now be past the transcript birthtime');

    await appendFile(transcriptPath, claudeRecord(sessionId, projectPath));

    const nextScan = await sessionSynchronizerService.synchronizeSessions();

    assert.deepEqual(nextScan.failures, []);
    assert.equal(nextScan.processedByProvider.claude, 1);
    const indexed = sessionsDb.getSessionById(sessionId);
    assert.ok(indexed, 'the completed transcript must be indexed by the next incremental scan');
    assert.equal(indexed.project_path, projectPath);
    assert.equal(indexed.jsonl_path, transcriptPath);
  });
});

test('an incremental scan skips transcripts untouched since the previous scan', async () => {
  await withIsolatedDatabase(async () => {
    const sessionId = '7f0e7d4e-0000-4000-8000-000000000002';
    const projectDirectory = path.join(fixtureHome, '.claude', 'projects', '-tmp-settled-project');
    await mkdir(projectDirectory, { recursive: true });
    const transcriptPath = path.join(projectDirectory, `${sessionId}.jsonl`);
    await writeFile(transcriptPath, claudeRecord(sessionId, '/tmp/settled-project'));
    const { mtime } = await stat(transcriptPath);

    await waitUntilCursorCanPass(mtime);
    const firstScan = await sessionSynchronizerService.synchronizeSessions();
    assert.equal(firstScan.processedByProvider.claude, 1);

    // Nothing was written since: the scan must not degrade into a full rescan.
    const secondScan = await sessionSynchronizerService.synchronizeSessions();
    assert.deepEqual(secondScan.failures, []);
    assert.equal(secondScan.processedByProvider.claude, 0);
  });
});

test('an incremental scan re-indexes a transcript written since it was indexed', async () => {
  await withIsolatedDatabase(async () => {
    const sessionId = '7f0e7d4e-0000-4000-8000-000000000003';
    const projectDirectory = path.join(fixtureHome, '.claude', 'projects', '-tmp-offline-title');
    await mkdir(projectDirectory, { recursive: true });
    const transcriptPath = path.join(projectDirectory, `${sessionId}.jsonl`);
    await writeFile(transcriptPath, claudeRecord(sessionId, '/tmp/offline-title'));
    const { mtime } = await stat(transcriptPath);

    await waitUntilCursorCanPass(mtime);
    const firstScan = await sessionSynchronizerService.synchronizeSessions();
    assert.equal(firstScan.processedByProvider.claude, 1);
    assert.equal(sessionsDb.getSessionById(sessionId)?.custom_name, 'Untitled Claude Session');

    // Claude Code titles the session while no watcher sees it (server down).
    await appendFile(
      transcriptPath,
      `${JSON.stringify({ type: 'ai-title', sessionId, aiTitle: 'Offline title' })}\n`,
    );

    const nextScan = await sessionSynchronizerService.synchronizeSessions();

    assert.deepEqual(nextScan.failures, []);
    assert.equal(nextScan.processedByProvider.claude, 1);
    assert.equal(sessionsDb.getSessionById(sessionId)?.custom_name, 'Offline title');
  });
});

type FileProviderFixture = {
  provider: 'claude' | 'codex' | 'cursor';
  /** Writes a transcript holding one indexable record and returns its path. */
  createTranscript: (sessionId: string, projectPath: string) => Promise<string>;
  /** A record the provider CLI appends when the session continues. */
  continuation: (sessionId: string, projectPath: string) => string;
};

const FILE_PROVIDER_FIXTURES: FileProviderFixture[] = [
  {
    provider: 'claude',
    createTranscript: async (sessionId, projectPath) => {
      const directory = path.join(fixtureHome, '.claude', 'projects', '-tmp-continued-project');
      await mkdir(directory, { recursive: true });
      const transcriptPath = path.join(directory, `${sessionId}.jsonl`);
      await writeFile(transcriptPath, claudeRecord(sessionId, projectPath));
      return transcriptPath;
    },
    continuation: (sessionId, projectPath) => claudeRecord(sessionId, projectPath),
  },
  {
    provider: 'codex',
    createTranscript: async (sessionId, projectPath) => {
      const directory = path.join(fixtureHome, '.codex', 'sessions', '2026', '07', '14');
      await mkdir(directory, { recursive: true });
      const transcriptPath = path.join(directory, `rollout-${sessionId}.jsonl`);
      await writeFile(
        transcriptPath,
        `${JSON.stringify({ type: 'session_meta', payload: { id: sessionId, cwd: projectPath } })}\n`,
      );
      return transcriptPath;
    },
    continuation: () =>
      `${JSON.stringify({ type: 'event_msg', payload: { type: 'user_message', message: 'more' } })}\n`,
  },
  {
    provider: 'cursor',
    createTranscript: async (sessionId, projectPath) => {
      // Cursor keeps the workspace path in a worker.log three levels up.
      const projectDirectory = path.join(fixtureHome, '.cursor', 'projects', 'tmp-continued-project');
      const directory = path.join(projectDirectory, 'agent-transcripts', sessionId);
      await mkdir(directory, { recursive: true });
      await writeFile(path.join(projectDirectory, 'worker.log'), `workspacePath=${projectPath}\n`);
      const transcriptPath = path.join(directory, `${sessionId}.jsonl`);
      await writeFile(
        transcriptPath,
        `${JSON.stringify({ role: 'user', message: { content: [{ type: 'text', text: 'hello' }] } })}\n`,
      );
      return transcriptPath;
    },
    continuation: () =>
      `${JSON.stringify({ role: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } })}\n`,
  },
];

for (const fixture of FILE_PROVIDER_FIXTURES) {
  test(`continuing a ${fixture.provider} session and then archiving its project survives the next scan`, async () => {
    await withIsolatedDatabase(async () => {
      const sessionId = '7f0e7d4e-0000-4000-8000-000000000004';
      const projectPath = '/tmp/continued-project';
      const transcriptPath = await fixture.createTranscript(sessionId, projectPath);
      const { mtime } = await stat(transcriptPath);

      // Page load: the projects fetch indexes the session and moves the cursor.
      await waitUntilCursorCanPass(mtime);
      const firstScan = await sessionSynchronizerService.synchronizeSessions();
      assert.equal(firstScan.processedByProvider[fixture.provider], 1);

      // The user continues the session, the watcher indexes the append, and the
      // user then archives the project.
      await appendFile(transcriptPath, fixture.continuation(sessionId, projectPath));
      const watcherUpdate = await sessionSynchronizerService.synchronizeProviderFile(
        fixture.provider,
        transcriptPath,
      );
      assert.equal(watcherUpdate.indexed, true);
      const project = projectsDb.getProjectPath(projectPath);
      assert.ok(project);
      projectsDb.updateProjectIsArchivedById(project.project_id, true);

      // Opening the Archived view (or a reload or restart) scans again. The
      // append is past the cursor but already indexed, so it is not upserted
      // again, and upserting is what re-activates a project.
      const nextScan = await sessionSynchronizerService.synchronizeSessions();

      assert.deepEqual(nextScan.failures, []);
      assert.equal(projectsDb.getProjectPath(projectPath)?.isArchived, 1, 'the project must stay archived');
      assert.equal(nextScan.processedByProvider[fixture.provider], 0);
    });
  });
}

test('a session the watcher indexed since the last scan keeps its archived project archived', async () => {
  await withIsolatedDatabase(async () => {
    const firstScan = await sessionSynchronizerService.synchronizeSessions();
    assert.deepEqual(firstScan.failures, []);
    // Create the transcript in a later second than the cursor, so its birthtime
    // alone puts it in range of the next scan.
    await waitUntilCursorCanPass(new Date());

    const sessionId = '7f0e7d4e-0000-4000-8000-000000000005';
    const projectPath = '/tmp/new-archived-project';
    const projectDirectory = path.join(fixtureHome, '.claude', 'projects', '-tmp-new-archived-project');
    await mkdir(projectDirectory, { recursive: true });
    const transcriptPath = path.join(projectDirectory, `${sessionId}.jsonl`);
    await writeFile(transcriptPath, claudeRecord(sessionId, projectPath));
    const watcherAdd = await sessionSynchronizerService.synchronizeProviderFile('claude', transcriptPath);
    assert.equal(watcherAdd.indexed, true);
    const project = projectsDb.getProjectPath(projectPath);
    assert.ok(project);
    projectsDb.updateProjectIsArchivedById(project.project_id, true);

    const nextScan = await sessionSynchronizerService.synchronizeSessions();

    assert.deepEqual(nextScan.failures, []);
    assert.equal(projectsDb.getProjectPath(projectPath)?.isArchived, 1, 'the project must stay archived');
    assert.equal(nextScan.processedByProvider.claude, 0);
  });
});
