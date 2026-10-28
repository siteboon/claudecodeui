import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, getConnection, initializeDatabase, scanStateDb } from '@/modules/database/index.js';

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'scan-state-db-'));

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

test('a scan cursor recorded by an older scanner is ignored until rescanned', { concurrency: false }, async () => {
  await withIsolatedDatabase(async () => {
    // A database written by the creation-time scanner: a cursor row with no
    // scanner kind. Files that scanner skipped must be revisited once, so the
    // cursor cannot be trusted even though it is not empty.
    getConnection()
      .prepare("INSERT INTO scan_state (id, last_scanned_at) VALUES (1, '2026-10-01 00:00:00')")
      .run();

    assert.equal(scanStateDb.getLastScannedAt(), null);
  });
});

test('a cursor written by the current scanner is honoured and then advances', { concurrency: false }, async () => {
  await withIsolatedDatabase(async () => {
    assert.equal(scanStateDb.getLastScannedAt(), null, 'before any scan there is no cursor');

    const scannedAt = new Date('2026-10-28T09:30:00.000Z');
    scanStateDb.updateLastScannedAt(scannedAt);

    const cursor = scanStateDb.getLastScannedAt();
    assert.ok(cursor, 'after a completed scan the cursor must be readable');
    assert.equal(cursor?.toISOString(), '2026-10-28T09:30:00.000Z');
  });
});
