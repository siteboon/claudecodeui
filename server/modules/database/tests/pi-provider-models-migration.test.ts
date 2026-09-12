import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  closeConnection,
  getConnection,
  initializeDatabase,
  providerModelsDb,
} from '@/modules/database/index.js';
import { runMigrations } from '@/modules/database/migrations.js';

// The provider_models shape shipped before the pi provider existed. Legacy
// installs carry this exact table, and its CHECK constraint is what kept
// 'pi' rows out of the database until the rebuild migration runs.
const LEGACY_PROVIDER_MODELS_SCHEMA_SQL = `
CREATE TABLE provider_models (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT NOT NULL CHECK (provider IN ('claude', 'cursor', 'codex', 'opencode')),
    model_id TEXT NOT NULL,
    model_name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(provider, model_id)
);
`;

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'pi-provider-models-db-'));
  const databasePath = path.join(tempDirectory, 'auth.db');

  closeConnection();
  process.env.DATABASE_PATH = databasePath;

  try {
    await initializeDatabase();
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

test('provider_models accepts pi rows on a fresh install', async () => {
  await withIsolatedDatabase(() => {
    const db = getConnection();

    db.prepare(`
      INSERT INTO provider_models (provider, model_id, model_name, sort_order)
      VALUES ('pi', 'pi/local-model', 'Local pi Model', 3)
    `).run();

    const stored = providerModelsDb.listCustomProviderModels('pi');
    assert.equal(stored.length, 1);
    assert.equal(stored[0].provider, 'pi');
    assert.equal(stored[0].modelId, 'pi/local-model');
    assert.equal(stored[0].model, 'Local pi Model');
    assert.equal(stored[0].sortOrder, 3);

    // Legacy providers keep working, and the constraint still rejects
    // providers outside the list instead of letting anything through.
    db.prepare(`
      INSERT INTO provider_models (provider, model_id, model_name)
      VALUES ('codex', 'codex/local-model', 'Local codex Model')
    `).run();
    assert.equal(providerModelsDb.listCustomProviderModels('codex').length, 1);
    assert.throws(
      () => db.prepare(`
        INSERT INTO provider_models (provider, model_id, model_name)
        VALUES ('not-a-provider', 'x/y', 'X')
      `).run(),
      /CHECK constraint failed/,
    );
  });
});

test('migration rebuilds a legacy provider_models table without losing rows', async () => {
  await withIsolatedDatabase(() => {
    const db = getConnection();

    // Simulate a pre-pi install: the table exists with the old CHECK and
    // holds user-created rows that must survive the rebuild.
    db.exec('DROP TABLE provider_models');
    db.exec(LEGACY_PROVIDER_MODELS_SCHEMA_SQL);
    const legacyRows = [
      { id: 7, provider: 'claude', model_id: 'claude/custom-model', model_name: 'Custom Claude Model', sort_order: 1 },
      { id: 9, provider: 'codex', model_id: 'codex/gateway-model', model_name: 'Gateway Codex Model', sort_order: 2 },
    ];
    for (const row of legacyRows) {
      db.prepare(`
        INSERT INTO provider_models (id, provider, model_id, model_name, sort_order)
        VALUES (@id, @provider, @model_id, @model_name, @sort_order)
      `).run(row);
    }

    assert.throws(
      () => db.prepare(`
        INSERT INTO provider_models (provider, model_id, model_name)
        VALUES ('pi', 'pi/local-model', 'Local pi Model')
      `).run(),
      /CHECK constraint failed/,
    );

    runMigrations(db);

    // Old rows survive with their ids, names and ordering intact.
    for (const row of legacyRows) {
      assert.deepEqual(
        db.prepare(`
          SELECT id, provider, model_id, model_name, sort_order
          FROM provider_models
          WHERE provider = ? AND model_id = ?
        `).get(row.provider, row.model_id),
        row,
      );
    }

    // 'pi' rows are accepted after the rebuild and read back through the
    // repository like any other provider's models.
    db.prepare(`
      INSERT INTO provider_models (provider, model_id, model_name, sort_order)
      VALUES ('pi', 'pi/local-model', 'Local pi Model', 3)
    `).run();
    const piModels = providerModelsDb.listCustomProviderModels('pi');
    assert.equal(piModels.length, 1);
    assert.equal(piModels[0].modelId, 'pi/local-model');

    // The provider-order index is recreated on the rebuilt table, and the
    // remaining constraints are untouched.
    const indexedColumns = (db
      .prepare('PRAGMA index_info(idx_provider_models_provider_order)')
      .all() as Array<{ name: string }>)
      .map((column) => column.name);
    assert.deepEqual(indexedColumns, ['provider', 'sort_order', 'id']);
    assert.throws(
      () => db.prepare(`
        INSERT INTO provider_models (provider, model_id, model_name)
        VALUES ('pi', 'pi/local-model', 'Local pi Model')
      `).run(),
      /UNIQUE constraint failed/,
    );

    // A second pass over an already-migrated table is a no-op that keeps
    // every row exactly where it was.
    runMigrations(db);
    assert.equal(
      (db.prepare('SELECT COUNT(*) AS count FROM provider_models').get() as { count: number }).count,
      3,
    );
    assert.equal(providerModelsDb.listCustomProviderModels('pi').length, 1);
  });
});
