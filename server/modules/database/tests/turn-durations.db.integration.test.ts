import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection } from '@/modules/database/connection.js';
import { initializeDatabase } from '@/modules/database/init-db.js';
import { turnDurationsDb } from '@/modules/database/repositories/turn-durations.db.js';

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'turn-durations-db-'));
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

test('a recorded duration comes back keyed by the row it belongs to', async () => {
  await withIsolatedDatabase(() => {
    turnDurationsDb.record('sess-1', 'uuid-a', { durationMs: 1_141, durationApiMs: 1_848 });

    const durations = turnDurationsDb.listForSession('sess-1');

    assert.deepEqual(durations.get('uuid-a'), { durationMs: 1_141, durationApiMs: 1_848 });
  });
});

test('re-recording a turn replaces it instead of failing', async () => {
  // The same turn is written again when a run is resumed or superseded, and a
  // primary-key collision must not take the run down with it.
  await withIsolatedDatabase(() => {
    turnDurationsDb.record('sess-1', 'uuid-a', { durationMs: 1_000, durationApiMs: null });
    turnDurationsDb.record('sess-1', 'uuid-a', { durationMs: 2_000, durationApiMs: 1_500 });

    assert.deepEqual(turnDurationsDb.listForSession('sess-1').get('uuid-a'), {
      durationMs: 2_000,
      durationApiMs: 1_500,
    });
  });
});

test('durations are scoped to their own session', async () => {
  await withIsolatedDatabase(() => {
    turnDurationsDb.record('sess-1', 'uuid-a', { durationMs: 1_000, durationApiMs: null });
    turnDurationsDb.record('sess-2', 'uuid-b', { durationMs: 2_000, durationApiMs: null });

    assert.deepEqual([...turnDurationsDb.listForSession('sess-2').keys()], ['uuid-b']);
  });
});

test('a nonsense duration is dropped rather than stored', async () => {
  await withIsolatedDatabase(() => {
    turnDurationsDb.record('sess-1', '', { durationMs: 1_000, durationApiMs: null });
    turnDurationsDb.record('sess-1', 'uuid-a', { durationMs: Number.NaN, durationApiMs: null });

    assert.equal(turnDurationsDb.listForSession('sess-1').size, 0);
  });
});
