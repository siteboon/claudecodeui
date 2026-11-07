import assert from 'node:assert/strict';
import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { buildCloudCliSessionName } from '@/shared/utils.js';

// The synchronizer resolves `os.homedir()` when its module loads, so HOME has
// to point at a fixture home before the import.
const fixtureHome = await mkdtemp(path.join(os.tmpdir(), 'claude-ai-title-home-'));
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

const projectPath = path.join(fixtureHome, 'repo');
const transcriptDir = path.join(fixtureHome, '.claude', 'projects', projectPath.replace(/[^a-zA-Z0-9]/g, '-'));

async function withIsolatedDatabase(runTest: () => Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'claude-ai-title-db-'));
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

const line = (providerSessionId: string, fields: Record<string, unknown>) =>
  `${JSON.stringify({ sessionId: providerSessionId, cwd: projectPath, ...fields })}\n`;
const userPrompt = (providerSessionId: string, text: string) =>
  line(providerSessionId, { type: 'user', message: { role: 'user', content: text } });
const aiTitle = (providerSessionId: string, title: string) =>
  line(providerSessionId, { type: 'ai-title', aiTitle: title });

/** An app-created session, mapped to its transcript, as a send leaves it. */
async function appSession(appId: string, providerSessionId: string, firstMessage: string): Promise<string> {
  sessionsDb.createAppSession(appId, 'claude', projectPath, buildCloudCliSessionName(firstMessage));
  sessionsDb.assignProviderSessionId(appId, providerSessionId);
  await mkdir(transcriptDir, { recursive: true });
  const filePath = path.join(transcriptDir, `${providerSessionId}.jsonl`);
  await writeFile(filePath, userPrompt(providerSessionId, firstMessage));
  return filePath;
}

const nameOf = (appId: string) => sessionsDb.getSessionById(appId)?.custom_name;

test('an app session takes the title Claude writes, and follows it', async () => {
  await withIsolatedDatabase(async () => {
    const synchronizer = new ClaudeSessionSynchronizer();
    const filePath = await appSession('app-1', 'native-1', 'Fix the flaky login test in CI please');
    assert.equal(nameOf('app-1'), 'Fix the flaky login');

    await synchronizer.synchronizeFile(filePath);
    assert.equal(nameOf('app-1'), 'Fix the flaky login', 'no title yet: the placeholder stays');

    await appendFile(filePath, aiTitle('native-1', 'Flaky login test fix'));
    await synchronizer.synchronizeFile(filePath);
    assert.equal(nameOf('app-1'), 'Flaky login test fix');

    await appendFile(filePath, aiTitle('native-1', 'Login test and CI retry policy'));
    await synchronizer.synchronizeFile(filePath);
    assert.equal(nameOf('app-1'), 'Login test and CI retry policy', 'a later title replaces the first');
  });
});

test('a name someone chose is never replaced by the title', async () => {
  await withIsolatedDatabase(async () => {
    const synchronizer = new ClaudeSessionSynchronizer();
    const filePath = await appSession('app-2', 'native-2', 'Fix the flaky login test');
    await appendFile(filePath, aiTitle('native-2', 'Flaky login'));
    await synchronizer.synchronizeFile(filePath);
    assert.equal(nameOf('app-2'), 'Flaky login');

    // A rename in the app is stored in the database, and nowhere in the transcript.
    sessionsDb.updateSessionCustomName('app-2', 'Renamed by hand');
    await appendFile(filePath, aiTitle('native-2', 'Flaky login, round two'));
    await synchronizer.synchronizeFile(filePath);
    assert.equal(nameOf('app-2'), 'Renamed by hand');
  });
});

test('a /rename in the CLI wins over the AI title', async () => {
  await withIsolatedDatabase(async () => {
    const synchronizer = new ClaudeSessionSynchronizer();
    const filePath = await appSession('app-3', 'native-3', 'Fix the flaky login test');
    await appendFile(filePath, line('native-3', { type: 'custom-title', customTitle: 'Chosen in the CLI' }));
    await appendFile(filePath, aiTitle('native-3', 'Flaky login'));
    await synchronizer.synchronizeFile(filePath);
    assert.equal(nameOf('app-3'), 'Chosen in the CLI');
  });
});

test('a first prompt sent with an attachment still identifies the placeholder', async () => {
  await withIsolatedDatabase(async () => {
    const synchronizer = new ClaudeSessionSynchronizer();
    sessionsDb.createAppSession('app-4', 'claude', projectPath, buildCloudCliSessionName('Look at this screenshot please'));
    sessionsDb.assignProviderSessionId('app-4', 'native-4');
    await mkdir(transcriptDir, { recursive: true });
    const filePath = path.join(transcriptDir, 'native-4.jsonl');
    await writeFile(filePath, line('native-4', {
      type: 'user',
      message: { role: 'user', content: [{ type: 'image' }, { type: 'text', text: 'Look at this screenshot please' }] },
    }) + aiTitle('native-4', 'Screenshot review'));
    await synchronizer.synchronizeFile(filePath);
    assert.equal(nameOf('app-4'), 'Screenshot review');
  });
});

test('a rename that lands while the synchronizer reads the transcript is kept', async () => {
  await withIsolatedDatabase(async () => {
    const synchronizer = new ClaudeSessionSynchronizer();
    const filePath = await appSession('app-5', 'native-5', 'Fix the flaky login test');
    await appendFile(filePath, aiTitle('native-5', 'Flaky login'));

    // The rename arrives after the synchronizer read the placeholder, while it
    // is still reading the transcript for the title.
    const original = sessionsDb.getSessionByProviderSessionId.bind(sessionsDb);
    sessionsDb.getSessionByProviderSessionId = (id: string) => {
      const row = original(id);
      sessionsDb.updateSessionCustomName('app-5', 'Renamed mid-sync');
      return row;
    };
    try {
      await synchronizer.synchronizeFile(filePath);
    } finally {
      sessionsDb.getSessionByProviderSessionId = original;
    }
    assert.equal(nameOf('app-5'), 'Renamed mid-sync');
  });
});
