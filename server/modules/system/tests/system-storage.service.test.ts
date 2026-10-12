import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import Database from 'better-sqlite3';

import {
  closeConnection,
  getConnection,
  initializeDatabase,
  projectsDb,
  userDb,
} from '@/modules/database/index.js';
import { AppError } from '@/shared/utils.js';

import { createSystemStorageService } from '../system-storage.service.js';

type SystemStorageDependencies = Parameters<typeof createSystemStorageService>[0];

const FIXED_NOW = new Date('2026-10-12T18:30:05.123Z');

function createDependencies(
  overrides: Partial<SystemStorageDependencies> = {},
): SystemStorageDependencies {
  return {
    isPlatform: false,
    getDatabasePath: () => '/data/cloudcli/auth.db',
    getAssetsPath: () => '/home/cloudcli/.cloudcli/assets',
    backupDatabase: async () => {
      throw new Error('Unexpected backup');
    },
    temporaryDirectory: tmpdir(),
    now: () => FIXED_NOW,
    ...overrides,
  };
}

/** Runs `runTest` against a fresh database holding one user and one project. */
async function withSeededDatabase(
  runTest: (fixtureDirectory: string) => Promise<void>,
): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const fixtureDirectory = await mkdtemp(path.join(tmpdir(), 'system-storage-'));

  closeConnection();
  process.env.DATABASE_PATH = path.join(fixtureDirectory, 'auth.db');
  await initializeDatabase();
  userDb.createUser('backup-user', 'password-hash');
  projectsDb.createProjectPath('/workspace/backup-project', 'Backup Project');

  try {
    await runTest(fixtureDirectory);
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(fixtureDirectory, { recursive: true, force: true });
  }
}

function assertPlatformRefusal(error: unknown): true {
  assert.ok(error instanceof AppError);
  assert.equal(error.statusCode, 403);
  assert.equal(error.code, 'PLATFORM_MANAGED_STORAGE');
  return true;
}

test('storage locations are reported as absolute paths, resolving relative ones', () => {
  // Both inputs are relative on purpose: each one must be resolved against the working directory.
  const service = createSystemStorageService(createDependencies({
    getDatabasePath: () => path.join('data', 'auth.db'),
    getAssetsPath: () => path.join('uploads', 'assets'),
  }));

  assert.deepEqual(service.getStorageLocations(), {
    databasePath: path.resolve('data', 'auth.db'),
    assetsPath: path.resolve('uploads', 'assets'),
  });
});

test('a backup is a valid SQLite database with the same users and projects', async () => {
  await withSeededDatabase(async (fixtureDirectory) => {
    const service = createSystemStorageService(createDependencies({
      backupDatabase: (destinationPath) => getConnection().backup(destinationPath),
      temporaryDirectory: fixtureDirectory,
    }));

    const backup = await service.createDatabaseBackup();

    assert.equal(backup.fileName, 'cloudcli-backup-2026-10-12T18-30-05Z.db');
    const snapshot = new Database(backup.contents, { readonly: true });
    try {
      assert.equal(snapshot.pragma('integrity_check', { simple: true }), 'ok');
      assert.deepEqual(
        snapshot.prepare('SELECT username FROM users').all(),
        [{ username: 'backup-user' }],
      );
      assert.deepEqual(
        snapshot.prepare('SELECT project_path, custom_project_name FROM projects').all(),
        [{ project_path: '/workspace/backup-project', custom_project_name: 'Backup Project' }],
      );
    } finally {
      snapshot.close();
    }
  });
});

test('the snapshot is written owner-only into a private directory that is removed afterwards', async () => {
  await withSeededDatabase(async (fixtureDirectory) => {
    const snapshotParent = path.join(fixtureDirectory, 'snapshots');
    await mkdir(snapshotParent);
    const observed: { directoryMode: number; fileMode: number; directory: string }[] = [];
    const service = createSystemStorageService(createDependencies({
      temporaryDirectory: snapshotParent,
      backupDatabase: async (destinationPath) => {
        const [directoryStats, fileStats] = await Promise.all([
          stat(path.dirname(destinationPath)),
          stat(destinationPath),
        ]);
        observed.push({
          directory: path.dirname(destinationPath),
          directoryMode: directoryStats.mode & 0o777,
          fileMode: fileStats.mode & 0o777,
        });
        return getConnection().backup(destinationPath);
      },
    }));

    await service.createDatabaseBackup();

    assert.equal(observed.length, 1);
    assert.equal(path.dirname(observed[0].directory), snapshotParent);
    if (process.platform !== 'win32') {
      assert.equal(observed[0].directoryMode, 0o700);
      assert.equal(observed[0].fileMode, 0o600);
    }
    assert.deepEqual(await readdir(snapshotParent), []);
  });
});

test('a backup taken while the database is busy waits for the write to finish', async () => {
  await withSeededDatabase(async (fixtureDirectory) => {
    const connection = getConnection();
    let attempts = 0;
    const service = createSystemStorageService(createDependencies({
      temporaryDirectory: fixtureDirectory,
      backupDatabase: (destinationPath) => {
        attempts += 1;
        return connection.backup(destinationPath);
      },
    }));

    // An uncommitted write on the source (here on the shared connection; in
    // production typically another process committing to the same file) makes
    // better-sqlite3 report a 0-page "backup".
    connection.exec('BEGIN IMMEDIATE');
    userDb.createUser('late-user', 'password-hash');
    const pendingBackup = service.createDatabaseBackup();
    setTimeout(() => connection.exec('COMMIT'), 50);
    const backup = await pendingBackup;

    assert.ok(attempts > 1, `expected a retry, got ${attempts} attempt(s)`);
    const snapshot = new Database(backup.contents, { readonly: true });
    try {
      assert.deepEqual(
        snapshot.prepare('SELECT username FROM users ORDER BY id').all(),
        [{ username: 'backup-user' }, { username: 'late-user' }],
      );
    } finally {
      snapshot.close();
    }
  });
});

test('a database that stays busy yields a 503 instead of an empty backup, and leaves nothing on disk', async () => {
  await withSeededDatabase(async (fixtureDirectory) => {
    const snapshotParent = path.join(fixtureDirectory, 'snapshots');
    await mkdir(snapshotParent);
    const connection = getConnection();
    const service = createSystemStorageService(createDependencies({
      temporaryDirectory: snapshotParent,
      backupDatabase: (destinationPath) => connection.backup(destinationPath),
    }));

    connection.exec('BEGIN IMMEDIATE');
    try {
      await assert.rejects(service.createDatabaseBackup(), (error: unknown) => {
        assert.ok(error instanceof AppError);
        assert.equal(error.statusCode, 503);
        assert.equal(error.code, 'DATABASE_BUSY');
        return true;
      });
    } finally {
      connection.exec('ROLLBACK');
    }
    assert.deepEqual(await readdir(snapshotParent), []);
  });
});

test('a failed backup rejects and still removes the private snapshot directory', async () => {
  const snapshotParent = await mkdtemp(path.join(tmpdir(), 'system-storage-failure-'));
  try {
    const service = createSystemStorageService(createDependencies({
      temporaryDirectory: snapshotParent,
      backupDatabase: async () => {
        throw new Error('disk full');
      },
    }));

    await assert.rejects(service.createDatabaseBackup(), /disk full/);
    assert.deepEqual(await readdir(snapshotParent), []);
  } finally {
    await rm(snapshotParent, { recursive: true, force: true });
  }
});

test('platform installs refuse both the storage locations and the backup', async () => {
  let backupCalls = 0;
  const service = createSystemStorageService(createDependencies({
    isPlatform: true,
    backupDatabase: async () => {
      backupCalls += 1;
      return { totalPages: 1 };
    },
  }));

  assert.throws(() => service.getStorageLocations(), assertPlatformRefusal);
  await assert.rejects(service.createDatabaseBackup(), assertPlatformRefusal);
  assert.equal(backupCalls, 0);
});
