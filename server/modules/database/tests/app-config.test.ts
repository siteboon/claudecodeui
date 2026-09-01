import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import Database from 'better-sqlite3';

import { closeConnection, getConnection } from '@/modules/database/connection.js';
import { initializeDatabase } from '@/modules/database/init-db.js';
import { appConfigDb } from '@/modules/database/repositories/app-config.js';

async function withIsolatedDatabase(
  runTest: (databasePath: string) => void | Promise<void>
): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'app-config-'));
  const databasePath = path.join(tempDirectory, 'auth.db');

  closeConnection();
  process.env.DATABASE_PATH = databasePath;

  try {
    // Inside the try: a failed init must still restore DATABASE_PATH and
    // remove the temporary directory.
    await initializeDatabase();
    await runTest(databasePath);
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

test('getOrCreateJwtSecret returns the same secret across a reconnect', async () => {
  await withIsolatedDatabase(() => {
    const first = appConfigDb.getOrCreateJwtSecret();
    assert.equal(first.length, 128);

    // Stands in for a server restart: same file, brand new connection.
    closeConnection();

    assert.equal(appConfigDb.getOrCreateJwtSecret(), first);
  });
});

test('getOrCreateSecret never regenerates once a value is stored', async () => {
  await withIsolatedDatabase(() => {
    assert.equal(appConfigDb.getOrCreateSecret('test_secret', () => 'stored'), 'stored');

    const reread = appConfigDb.getOrCreateSecret('test_secret', () => {
      throw new Error('generator must not run for an existing key');
    });

    assert.equal(reread, 'stored');
  });
});

test('getOrCreateSecret yields to a racing writer instead of overwriting it', async () => {
  await withIsolatedDatabase((databasePath) => {
    // The generator body simulates another process winning the insert between
    // our read and our write — the exact race that used to rotate the secret.
    const resolved = appConfigDb.getOrCreateSecret('test_secret', () => {
      const racer = new Database(databasePath);
      racer
        .prepare('INSERT INTO app_config (key, value) VALUES (?, ?)')
        .run('test_secret', 'written-by-racer');
      racer.close();
      return 'losing-candidate';
    });

    assert.equal(resolved, 'written-by-racer');
    assert.equal(appConfigDb.get('test_secret'), 'written-by-racer');
  });
});

test('a failed read throws instead of reporting the key as absent', async () => {
  await withIsolatedDatabase(() => {
    const original = appConfigDb.getOrCreateJwtSecret();

    // Any unreadable table stands in for a transient read failure.
    getConnection().exec('DROP TABLE app_config');

    assert.throws(() => appConfigDb.get('jwt_secret'));
    // The critical regression: an unreadable secret must never be treated as
    // an absent one and replaced with a freshly minted value.
    assert.throws(() => appConfigDb.getOrCreateJwtSecret());
    assert.equal(original.length, 128);
  });
});

test('an empty stored secret is refused rather than treated as absent', async () => {
  await withIsolatedDatabase(() => {
    getConnection()
      .prepare('INSERT INTO app_config (key, value) VALUES (?, ?)')
      .run('test_secret', '');

    // A row holding '' is corruption, not absence: INSERT OR IGNORE cannot
    // replace it, so calling it absent would return '' on the next read, and
    // signing with an empty secret rejects every token already issued.
    assert.throws(
      () => appConfigDb.getOrCreateSecret('test_secret', () => 'replacement'),
      /exists but is empty/
    );
    assert.equal(appConfigDb.get('test_secret'), '');
  });
});

test('an empty generated secret never reaches the table', async () => {
  await withIsolatedDatabase(() => {
    assert.throws(() => appConfigDb.getOrCreateSecret('test_secret', () => ''), /is empty/);

    // The key has to stay absent. A persisted '' would be permanent, because
    // INSERT OR IGNORE cannot replace it, so a later call must still be able
    // to create the secret for real.
    assert.equal(appConfigDb.get('test_secret'), null);
    assert.equal(appConfigDb.getOrCreateSecret('test_secret', () => 'recovered'), 'recovered');
  });
});
