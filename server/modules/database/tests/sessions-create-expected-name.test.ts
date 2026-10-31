import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';

async function withIsolatedDatabase(runTest: () => Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'sessions-expected-name-db-'));
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

const projectPath = path.join(os.tmpdir(), 'sessions-expected-name-repo');
const nameOf = (id: string) => sessionsDb.getSessionById(id)?.custom_name;

test('createSession keeps a rename made after the caller read the name', async () => {
  await withIsolatedDatabase(async () => {
    sessionsDb.createSession('native-1', 'claude', projectPath, 'First words');
    sessionsDb.updateSessionCustomName('native-1', 'Renamed meanwhile');

    // The caller decided on 'First words' after reading 'First words'.
    sessionsDb.createSession('native-1', 'claude', projectPath, 'First words', undefined, undefined, null, 'First words');
    assert.equal(nameOf('native-1'), 'Renamed meanwhile');
  });
});

test('createSession still applies a name when the row carries the one read', async () => {
  await withIsolatedDatabase(async () => {
    sessionsDb.createSession('native-2', 'claude', projectPath, 'First words');
    sessionsDb.createSession('native-2', 'claude', projectPath, 'A better name', undefined, undefined, null, 'First words');
    assert.equal(nameOf('native-2'), 'A better name');
  });
});

test('createSession without an expected name behaves as before', async () => {
  await withIsolatedDatabase(async () => {
    sessionsDb.createSession('native-3', 'claude', projectPath, 'First words');
    sessionsDb.updateSessionCustomName('native-3', 'Renamed meanwhile');
    sessionsDb.createSession('native-3', 'claude', projectPath, 'Overwritten');
    assert.equal(nameOf('native-3'), 'Overwritten');
  });
});

test('createSession keeps a rename of a row that had no name when it was read (update path)', async () => {
  await withIsolatedDatabase(async () => {
    sessionsDb.createSession('native-4', 'claude', projectPath, undefined);
    assert.equal(nameOf('native-4'), null);
    sessionsDb.updateSessionCustomName('native-4', 'Renamed meanwhile');
    // The caller read NULL, then decided on a name.
    sessionsDb.createSession('native-4', 'claude', projectPath, 'From the transcript', undefined, undefined, null, null);
    assert.equal(nameOf('native-4'), 'Renamed meanwhile');
  });
});

test('createSession applies a name to a row that still has none (update path)', async () => {
  await withIsolatedDatabase(async () => {
    sessionsDb.createSession('native-5', 'claude', projectPath, undefined);
    sessionsDb.createSession('native-5', 'claude', projectPath, 'From the transcript', undefined, undefined, null, null);
    assert.equal(nameOf('native-5'), 'From the transcript');
  });
});

test('createSession keeps a rename of a row that had no name when it was read (insert path)', async () => {
  await withIsolatedDatabase(async () => {
    // A legacy row: no provider id mapping, so createSession takes the ON CONFLICT path.
    sessionsDb.createAppSession('legacy-6', 'claude', projectPath, undefined);
    assert.equal(nameOf('legacy-6'), null);
    sessionsDb.updateSessionCustomName('legacy-6', 'Renamed meanwhile');
    sessionsDb.createSession('legacy-6', 'claude', projectPath, 'From the transcript', undefined, undefined, null, null);
    assert.equal(nameOf('legacy-6'), 'Renamed meanwhile');
  });
});
