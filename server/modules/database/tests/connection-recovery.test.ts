import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { afterEach } from 'node:test';

import {
  closeConnection,
  getConnection,
  getDatabasePath,
  isDatabaseMovedError,
  recoverFromDatabaseError,
} from '@/modules/database/connection.js';

const previousDatabasePath = process.env.DATABASE_PATH;
let temporaryDirectory: string | null = null;

afterEach(() => {
  closeConnection();

  if (previousDatabasePath === undefined) {
    delete process.env.DATABASE_PATH;
  } else {
    process.env.DATABASE_PATH = previousDatabasePath;
  }

  if (temporaryDirectory) {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    temporaryDirectory = null;
  }
});

function useTemporaryDatabase(): string {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'cloudcli-connection-'));
  const databasePath = path.join(temporaryDirectory, 'auth.db');
  process.env.DATABASE_PATH = databasePath;
  closeConnection();
  return databasePath;
}

/** The missing-file check is throttled, so tests must step past the window. */
const waitPastStaleCheck = () => new Promise((resolve) => setTimeout(resolve, 1050));

test('recovers from a moved-database error so the next query can succeed', () => {
  useTemporaryDatabase();

  const firstConnection = getConnection();
  firstConnection.exec('CREATE TABLE IF NOT EXISTS probe (value TEXT)');

  // This is the incident: SQLite latches the handle read-only once it notices
  // the file it opened was unlinked, and never recovers on its own.
  const movedError = Object.assign(new Error('attempt to write a readonly database'), {
    code: 'SQLITE_READONLY_DBMOVED',
  });

  assert.equal(recoverFromDatabaseError(movedError), true);

  const recovered = getConnection();
  assert.notEqual(recovered, firstConnection);

  recovered.exec('CREATE TABLE IF NOT EXISTS probe (value TEXT)');
  recovered.prepare('INSERT INTO probe (value) VALUES (?)').run('after');
  const rows = recovered.prepare('SELECT value FROM probe').all() as Array<{ value: string }>;
  assert.deepEqual(rows.map((row) => row.value), ['after']);
});

test('ignores errors that are not a moved database', () => {
  useTemporaryDatabase();

  const connection = getConnection();
  const unrelated = Object.assign(new Error('no such table: probe'), { code: 'SQLITE_ERROR' });

  assert.equal(isDatabaseMovedError(unrelated), false);
  assert.equal(recoverFromDatabaseError(unrelated), false);
  assert.equal(getConnection(), connection);
});

test('reopens when the handle was closed underneath the singleton', () => {
  useTemporaryDatabase();

  const firstConnection = getConnection();
  firstConnection.close();

  const recovered = getConnection();

  assert.notEqual(recovered, firstConnection);
  assert.equal(recovered.open, true);
});

test('reopens when the database file is deleted', async () => {
  const databasePath = useTemporaryDatabase();

  const firstConnection = getConnection();
  fs.rmSync(databasePath);

  await waitPastStaleCheck();
  const recovered = getConnection();

  assert.notEqual(recovered, firstConnection);
  assert.equal(fs.existsSync(databasePath), true);
});

test('keeps returning the same connection while the file is untouched', async () => {
  useTemporaryDatabase();

  const firstConnection = getConnection();
  await waitPastStaleCheck();

  assert.equal(getConnection(), firstConnection);
});

test('resolves an explicitly configured path over the default', () => {
  const databasePath = useTemporaryDatabase();

  assert.equal(getDatabasePath(), databasePath);
});
