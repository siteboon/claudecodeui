import assert from 'node:assert/strict';
import test from 'node:test';

import Database from 'better-sqlite3';

import { runMigrations } from '@/modules/database/migrations.js';
import { INIT_SCHEMA_SQL } from '@/modules/database/schema.js';

test('Antigravity migration preserves current-main custom-model effort metadata and stable rows', () => {
  const db = new Database(':memory:');
  try {
    // Simulate main before Antigravity, after reasoning effort was introduced.
    db.exec(INIT_SCHEMA_SQL.replace(
      "'claude', 'cursor', 'codex', 'opencode', 'antigravity'",
      "'claude', 'cursor', 'codex', 'opencode'",
    ));
    db.prepare(`
      INSERT INTO provider_models (id, provider, model_id, model_name, sort_order, created_at, updated_at, effort_values, effort_default)
      VALUES (42, 'codex', 'custom-model', 'Custom Model', 7, '2026-10-01', '2026-10-02', '["low","high"]', 'high')
    `).run();
    const before = db.prepare('SELECT * FROM provider_models WHERE id = 42').get();

    runMigrations(db);
    assert.deepEqual(db.prepare('SELECT * FROM provider_models WHERE id = 42').get(), before);
    const added = db.prepare(`
      INSERT INTO provider_models (provider, model_id, model_name, effort_values, effort_default)
      VALUES ('antigravity', 'agy-model', 'AGY Model', '["low","high"]', 'low')
    `).run();
    assert.ok(Number(added.lastInsertRowid) > 42);
    const rows = db.prepare('SELECT * FROM provider_models ORDER BY id').all();
    runMigrations(db);
    assert.deepEqual(db.prepare('SELECT * FROM provider_models ORDER BY id').all(), rows);
  } finally {
    db.close();
  }
});

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
