import assert from 'node:assert/strict';
import test from 'node:test';

import Database from 'better-sqlite3';

import { runMigrations } from '@/modules/database/migrations.js';
import { INIT_SCHEMA_SQL } from '@/modules/database/schema.js';

test('provider model migration adds Antigravity without losing existing rows', () => {
  const db = new Database(':memory:');
  try {
    db.exec(INIT_SCHEMA_SQL);
    db.exec('DROP TABLE provider_models');
    db.exec(`
      CREATE TABLE provider_models (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider TEXT NOT NULL CHECK (provider IN ('claude', 'cursor', 'codex', 'opencode')),
        model_id TEXT NOT NULL,
        model_name TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(provider, model_id)
      )
    `);
    db.prepare(`
      INSERT INTO provider_models (provider, model_id, model_name)
      VALUES ('claude', 'existing-model', 'Existing Model')
    `).run();

    runMigrations(db);

    db.prepare(`
      INSERT INTO provider_models (provider, model_id, model_name)
      VALUES ('antigravity', 'agy-model', 'AGY Model')
    `).run();
    const rows = db.prepare(`
      SELECT provider, model_id
      FROM provider_models
      ORDER BY id
    `).all();
    assert.deepEqual(rows, [
      { provider: 'claude', model_id: 'existing-model' },
      { provider: 'antigravity', model_id: 'agy-model' },
    ]);
  } finally {
    db.close();
  }
});
