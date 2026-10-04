import assert from 'node:assert/strict';
import { appendFile, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, scanStateDb, sessionsDb } from '@/modules/database/index.js';

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
    await rm(path.join(fixtureHome, '.claude'), { recursive: true, force: true });
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
