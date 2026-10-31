import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';

// The synchronizer resolves `os.homedir()` when its module loads.
const fixtureHome = await mkdtemp(path.join(os.tmpdir(), 'claude-sync-rename-home-'));
const previousHome = process.env.HOME;
process.env.HOME = fixtureHome;
const { ClaudeSessionSynchronizer } = await import(
  '@/modules/providers/list/claude/claude-session-synchronizer.provider.js'
);
process.on('exit', () => {
  if (previousHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = previousHome;
  }
});

async function withIsolatedDatabase(runTest: () => Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'claude-sync-rename-db-'));
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

const projectPath = path.join(fixtureHome, 'repo');
const nameOf = (id: string) => sessionsDb.getSessionById(id)?.custom_name;

test('a rename that lands while the Claude synchronizer reads the transcript is kept', async () => {
  await withIsolatedDatabase(async () => {
    const transcriptDir = path.join(fixtureHome, '.claude', 'projects', projectPath.replace(/[^a-zA-Z0-9]/g, '-'));
    await mkdir(transcriptDir, { recursive: true });
    const filePath = path.join(transcriptDir, 'native-4.jsonl');
    await writeFile(filePath, `${JSON.stringify({
      sessionId: 'native-4', cwd: projectPath, type: 'user', message: { role: 'user', content: 'Fix the login' },
    })}\n`);
    // Indexed from the CLI: keyed by the provider id, named from its first prompt.
    sessionsDb.createSession('native-4', 'claude', projectPath, 'Fix the login', undefined, undefined, filePath);

    const original = sessionsDb.getSessionByProviderSessionId.bind(sessionsDb);
    sessionsDb.getSessionByProviderSessionId = (id: string) => {
      const row = original(id);
      sessionsDb.updateSessionCustomName('native-4', 'Renamed mid-sync');
      return row;
    };
    try {
      await new ClaudeSessionSynchronizer().synchronizeFile(filePath);
    } finally {
      sessionsDb.getSessionByProviderSessionId = original;
    }
    assert.equal(nameOf('native-4'), 'Renamed mid-sync');
  });
});
