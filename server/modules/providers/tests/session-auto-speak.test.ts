import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { sessionsService } from '@/modules/providers/services/sessions.service.js';

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'session-auto-speak-db-'));

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

test('auto read-aloud is off for a session that never enabled it', { concurrency: false }, async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('app-session', 'claude', '/tmp/auto-speak-project');

    assert.deepEqual(sessionsService.getSessionAutoSpeak('app-session'), {
      sessionId: 'app-session',
      autoSpeak: false,
    });
  });
});

test('auto read-aloud survives being turned on and off again', { concurrency: false }, async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('app-session', 'claude', '/tmp/auto-speak-project');

    assert.deepEqual(sessionsService.setSessionAutoSpeak('app-session', true), {
      sessionId: 'app-session',
      autoSpeak: true,
      persisted: true,
    });
    assert.equal(sessionsService.getSessionAutoSpeak('app-session').autoSpeak, true);

    sessionsService.setSessionAutoSpeak('app-session', false);
    assert.equal(sessionsService.getSessionAutoSpeak('app-session').autoSpeak, false);
  });
});

test('auto read-aloud is scoped to one session', { concurrency: false }, async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('listening-session', 'claude', '/tmp/auto-speak-project');
    sessionsDb.createAppSession('quiet-session', 'claude', '/tmp/auto-speak-project');

    sessionsService.setSessionAutoSpeak('listening-session', true);

    assert.equal(sessionsService.getSessionAutoSpeak('listening-session').autoSpeak, true);
    assert.equal(sessionsService.getSessionAutoSpeak('quiet-session').autoSpeak, false);
  });
});

test('setting auto read-aloud before the session row exists reports it was not stored', { concurrency: false }, async () => {
  await withIsolatedDatabase(() => {
    // The composer can be toggled before the first send allocates the row. The
    // choice is echoed back so the UI keeps it, but nothing was persisted.
    assert.deepEqual(sessionsService.setSessionAutoSpeak('never-allocated', true), {
      sessionId: 'never-allocated',
      autoSpeak: true,
      persisted: false,
    });
    assert.equal(sessionsService.getSessionAutoSpeak('never-allocated').autoSpeak, false);
  });
});
