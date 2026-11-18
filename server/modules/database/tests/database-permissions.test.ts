import assert from 'node:assert/strict';
import { chmod, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, getConnection } from '@/modules/database/index.js';

const skip = process.platform === 'win32' ? 'POSIX permissions only' : false;

async function modeOf(targetPath: string): Promise<number> {
  return (await stat(targetPath)).mode & 0o777;
}

async function withDatabasePath(
  runTest: (tempDirectory: string) => Promise<void>,
): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'db-permissions-'));
  closeConnection();
  try {
    await runTest(tempDirectory);
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

test('a new database and the folder created for it are owner-only', { skip }, async () => {
  await withDatabasePath(async (tempDirectory) => {
    const databaseDirectory = path.join(tempDirectory, 'nested', 'data');
    const databasePath = path.join(databaseDirectory, 'auth.db');
    process.env.DATABASE_PATH = databasePath;

    getConnection();

    assert.equal(await modeOf(databaseDirectory), 0o700);
    assert.equal(await modeOf(databasePath), 0o600);
  });
});

test('an existing world-readable database is tightened', { skip }, async () => {
  await withDatabasePath(async (tempDirectory) => {
    const databasePath = path.join(tempDirectory, 'auth.db');
    process.env.DATABASE_PATH = databasePath;
    await writeFile(databasePath, '');
    await chmod(databasePath, 0o644);

    getConnection();

    assert.equal(await modeOf(databasePath), 0o600);
  });
});

test('an existing custom database folder keeps the permissions the user gave it', { skip }, async () => {
  await withDatabasePath(async (tempDirectory) => {
    await chmod(tempDirectory, 0o755);
    process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');

    getConnection();

    assert.equal(await modeOf(tempDirectory), 0o755);
  });
});
