import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  closeConnection,
  getConnection,
  initializeDatabase,
  userDb,
} from '@/modules/database/index.js';

const ACTIVE_USER_ID = 1;
const OTHER_USER_ID = 2;
const INACTIVE_USER_ID = 3;

/** Runs a test against a freshly migrated temporary database holding three users. */
async function withDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'users-password-db-'));
  const databasePath = path.join(tempDirectory, 'auth.db');

  closeConnection();
  process.env.DATABASE_PATH = databasePath;
  await writeFile(databasePath, '');
  await initializeDatabase();

  const insertUser = getConnection().prepare(
    'INSERT INTO users (id, username, password_hash, is_active) VALUES (?, ?, ?, ?)',
  );
  insertUser.run(ACTIVE_USER_ID, 'alice', 'alice-hash', 1);
  insertUser.run(OTHER_USER_ID, 'bob', 'bob-hash', 1);
  insertUser.run(INACTIVE_USER_ID, 'carol', 'carol-hash', 0);

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

test('getPasswordHashById returns the stored hash for an active user', async () => {
  await withDatabase(() => {
    assert.equal(userDb.getPasswordHashById(ACTIVE_USER_ID), 'alice-hash');
  });
});

test('getPasswordHashById returns undefined for inactive and unknown users', async () => {
  await withDatabase(() => {
    assert.equal(userDb.getPasswordHashById(INACTIVE_USER_ID), undefined);
    assert.equal(userDb.getPasswordHashById(999), undefined);
  });
});

test('updatePasswordHash replaces only the target user\'s hash', async () => {
  await withDatabase(() => {
    userDb.updatePasswordHash(ACTIVE_USER_ID, 'alice-new-hash');

    assert.equal(userDb.getPasswordHashById(ACTIVE_USER_ID), 'alice-new-hash');
    assert.equal(userDb.getPasswordHashById(OTHER_USER_ID), 'bob-hash');
    // The login lookup reads the same column, so the new hash is what login will verify against.
    assert.equal(userDb.getUserByUsername('alice')?.password_hash, 'alice-new-hash');
  });
});
