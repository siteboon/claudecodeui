import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import Database from 'better-sqlite3';

import {
  closeConnection,
  getConnection,
  initializeDatabase,
  providerModelsDb,
  sessionsDb,
} from '@/modules/database/index.js';
import { runMigrations } from '@/modules/database/migrations.js';

test('provider model repository stores custom rows only and maintains session references', async () => {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'provider-model-db-'));
  const databasePath = path.join(tempDirectory, 'auth.db');

  closeConnection();
  process.env.DATABASE_PATH = databasePath;
  await writeFile(databasePath, '');
  await initializeDatabase();

  try {
    const columns = getConnection().prepare('PRAGMA table_info(provider_models)').all() as Array<{
      name: string;
    }>;
    assert.deepEqual(columns.map((column) => column.name), [
      'id',
      'provider',
      'model_id',
      'model_name',
      'sort_order',
      'created_at',
      'updated_at',
      'effort_values',
      'effort_default',
    ]);
    assert.deepEqual(providerModelsDb.listCustomProviderModels('codex'), []);

    const custom = providerModelsDb.createCustomProviderModel('codex', {
      model: 'Private Gateway Model',
      id: 'gateway/model-v1',
    });
    assert.equal(custom.modelId, 'gateway/model-v1');
    assert.equal(custom.effort, null);
    assert.equal(
      providerModelsDb.findCustomProviderModelByModelId('codex', 'gateway/model-v1')?.recordId,
      custom.recordId,
    );

    const db = getConnection();
    db.prepare(`
      INSERT INTO projects (project_id, project_path)
      VALUES ('project-1', '/tmp/project-1')
    `).run();
    db.prepare(`
      INSERT INTO sessions (session_id, provider, project_path, model, effort)
      VALUES ('session-1', 'codex', '/tmp/project-1', 'gateway/model-v1', 'high')
    `).run();

    const updated = providerModelsDb.updateCustomProviderModel('codex', custom.recordId, {
      model: 'Private Gateway Model 2',
      id: 'gateway/model-v2',
    });
    assert.equal(updated?.modelId, 'gateway/model-v2');
    assert.equal(sessionsDb.getSessionById('session-1')?.model, 'gateway/model-v2');
    // A rename keeps the same underlying model, so its effort stays applicable.
    assert.equal(sessionsDb.getSessionById('session-1')?.effort, 'high');

    const removed = providerModelsDb.deleteCustomProviderModel(
      'codex',
      custom.recordId,
      'gpt-default',
    );
    assert.equal(removed?.modelId, 'gateway/model-v2');
    assert.equal(sessionsDb.getSessionById('session-1')?.model, 'gpt-default');
    // The effort belonged to the deleted model and must not survive onto the
    // fallback, which has its own default.
    assert.equal(sessionsDb.getSessionById('session-1')?.effort, null);
    assert.equal(providerModelsDb.getCustomProviderModel('codex', custom.recordId), null);
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
});

test('migrations create the provider model index on an install that lacks it', async () => {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'provider-model-index-'));
  const databasePath = path.join(tempDirectory, 'auth.db');

  closeConnection();
  process.env.DATABASE_PATH = databasePath;
  await writeFile(databasePath, '');
  await initializeDatabase();

  try {
    const db = getConnection();
    // Upgraded installs reach runMigrations with provider_models present but no
    // index, so the CREATE INDEX statement is compiled against the real table
    // instead of short-circuiting on the existing index name.
    db.exec('DROP INDEX IF EXISTS idx_provider_models_provider_order');

    runMigrations(db);

    const indexedColumns = (db
      .prepare('PRAGMA index_info(idx_provider_models_provider_order)')
      .all() as Array<{ name: string }>)
      .map((column) => column.name);
    assert.deepEqual(indexedColumns, ['provider', 'sort_order', 'id']);
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
});

test('provider model repository persists declared effort levels', async () => {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'provider-model-effort-'));
  const databasePath = path.join(tempDirectory, 'auth.db');

  closeConnection();
  process.env.DATABASE_PATH = databasePath;
  await writeFile(databasePath, '');
  await initializeDatabase();

  try {
    const custom = providerModelsDb.createCustomProviderModel('claude', {
      model: 'My Custom Model',
      id: 'my-custom-model',
      effort: { values: ['low', 'high'], default: 'high' },
    });
    assert.deepEqual(custom.effort, { values: ['low', 'high'], default: 'high' });
    assert.deepEqual(
      providerModelsDb.listCustomProviderModels('claude')[0]?.effort,
      { values: ['low', 'high'], default: 'high' },
    );

    // Omitting effort on update keeps the stored levels.
    const renamed = providerModelsDb.updateCustomProviderModel('claude', custom.recordId, {
      model: 'Renamed',
      id: 'my-custom-model',
    });
    assert.deepEqual(renamed?.effort, { values: ['low', 'high'], default: 'high' });

    const narrowed = providerModelsDb.updateCustomProviderModel('claude', custom.recordId, {
      model: 'Renamed',
      id: 'my-custom-model',
      effort: { values: ['medium'] },
    });
    assert.deepEqual(narrowed?.effort, { values: ['medium'] });

    const cleared = providerModelsDb.updateCustomProviderModel('claude', custom.recordId, {
      model: 'Renamed',
      id: 'my-custom-model',
      effort: null,
    });
    assert.equal(cleared?.effort, null);
    const row = getConnection()
      .prepare('SELECT effort_values, effort_default FROM provider_models WHERE id = ?')
      .get(custom.recordId);
    assert.deepEqual(row, { effort_values: null, effort_default: null });
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
});

test('migrations add effort columns to an existing provider model table and keep old rows NULL', async () => {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'provider-model-effort-migration-'));
  const databasePath = path.join(tempDirectory, 'auth.db');

  // The table as it shipped before effort metadata existed, with one user row.
  const legacyDb = new Database(databasePath);
  legacyDb.exec(`
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
    INSERT INTO provider_models (provider, model_id, model_name, sort_order)
    VALUES ('codex', 'legacy-model', 'Legacy Model', 0);
  `);
  legacyDb.close();

  closeConnection();
  process.env.DATABASE_PATH = databasePath;
  await initializeDatabase();

  try {
    const columnNames = (getConnection().prepare('PRAGMA table_info(provider_models)').all() as Array<{
      name: string;
    }>).map((column) => column.name);
    assert.deepEqual(columnNames.slice(-2), ['effort_values', 'effort_default']);

    const [legacy] = providerModelsDb.listCustomProviderModels('codex');
    assert.equal(legacy?.modelId, 'legacy-model');
    assert.equal(legacy?.effort, null);

    // Running the migrations again is a no-op.
    runMigrations(getConnection());
    assert.equal(providerModelsDb.listCustomProviderModels('codex')[0]?.effort, null);
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
});
