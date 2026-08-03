import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { PiSessionSynchronizer } from '@/modules/providers/list/pi/pi-session-synchronizer.provider.js';

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'pi-provider-db-'));
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

const SESSION_ID = '00000000-0000-4000-8000-000000000abc';
const WORKSPACE = '/tmp/pi-fake-workspace';

/** Writes a de-identified v3 Pi session JSONL and returns its path. */
async function writePiSession(
  sessionRoot: string,
  sessionId: string,
  fileName = 'session.jsonl',
): Promise<string> {
  await mkdir(sessionRoot, { recursive: true });
  const lines = [
    JSON.stringify({
      type: 'session',
      version: 3,
      id: sessionId,
      timestamp: '2026-08-03T00:00:00.000Z',
      cwd: WORKSPACE,
    }),
    JSON.stringify({
      type: 'model_change',
      id: 'e1',
      parentId: null,
      timestamp: '2026-08-03T00:00:01.000Z',
      provider: 'anthropic',
      modelId: 'claude-sonnet',
    }),
    JSON.stringify({
      type: 'message',
      id: 'e2',
      parentId: 'e1',
      timestamp: '2026-08-03T00:00:02.000Z',
      message: { role: 'user', content: [{ type: 'text', text: 'hi' }] },
    }),
  ];
  const filePath = path.join(sessionRoot, fileName);
  await writeFile(filePath, `${lines.join('\n')}\n`, 'utf8');
  return filePath;
}

test('Pi synchronizer discovers a new session and upserts its metadata', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'pi-session-sync-'));
  const sessionRoot = path.join(tempRoot, 'sessions');
  const original = process.env.PI_CODING_AGENT_SESSION_DIR;
  process.env.PI_CODING_AGENT_SESSION_DIR = sessionRoot;

  try {
    const filePath = await writePiSession(sessionRoot, SESSION_ID);
    await withIsolatedDatabase(async () => {
      const synchronizer = new PiSessionSynchronizer();
      const processed = await synchronizer.synchronize();

      assert.equal(processed, 1);
      const row = sessionsDb.getSessionByProviderSessionId(SESSION_ID);
      assert.ok(row, 'session should be upserted');
      assert.equal(row?.provider, 'pi');
      assert.equal(row?.project_path, WORKSPACE);
      assert.equal(row?.jsonl_path, filePath);
      assert.equal(row?.model, 'anthropic/claude-sonnet');
    });
  } finally {
    if (original === undefined) {
      delete process.env.PI_CODING_AGENT_SESSION_DIR;
    } else {
      process.env.PI_CODING_AGENT_SESSION_DIR = original;
    }
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('Pi synchronizer skips a corrupt file and still upserts the good one', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'pi-session-sync-bad-'));
  const sessionRoot = path.join(tempRoot, 'sessions');
  const original = process.env.PI_CODING_AGENT_SESSION_DIR;
  process.env.PI_CODING_AGENT_SESSION_DIR = sessionRoot;

  try {
    await writePiSession(sessionRoot, SESSION_ID, 'good.jsonl');
    await mkdir(sessionRoot, { recursive: true });
    // Corrupt: valid header then an invalid middle line (throws PI_SESSION_CORRUPT).
    const corruptLines = [
      JSON.stringify({ type: 'session', version: 3, id: 'bad-id', timestamp: '2026-08-03T00:00:00.000Z', cwd: WORKSPACE }),
      '{ not valid json',
      JSON.stringify({ type: 'message', id: 'x', parentId: null, timestamp: '2026-08-03T00:00:02.000Z' }),
    ];
    await writeFile(path.join(sessionRoot, 'bad.jsonl'), `${corruptLines.join('\n')}\n`, 'utf8');

    await withIsolatedDatabase(async () => {
      const synchronizer = new PiSessionSynchronizer();
      let processed = 0;
      await assert.doesNotReject(async () => {
        processed = await synchronizer.synchronize();
      });

      assert.equal(processed, 1);
      assert.ok(sessionsDb.getSessionByProviderSessionId(SESSION_ID), 'good session upserted');
      assert.equal(sessionsDb.getSessionByProviderSessionId('bad-id'), null, 'corrupt session skipped');
    });
  } finally {
    if (original === undefined) {
      delete process.env.PI_CODING_AGENT_SESSION_DIR;
    } else {
      process.env.PI_CODING_AGENT_SESSION_DIR = original;
    }
    await rm(tempRoot, { recursive: true, force: true });
  }
});
