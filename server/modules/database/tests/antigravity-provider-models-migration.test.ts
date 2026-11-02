import assert from 'node:assert/strict';
import test from 'node:test';

import Database from 'better-sqlite3';

import { runMigrations } from '@/modules/database/migrations.js';
import { INIT_SCHEMA_SQL } from '@/modules/database/schema.js';

for (const hasEffortMetadata of [false, true]) {
test(`provider model migration preserves rows and effort metadata (existing columns: ${hasEffortMetadata})`, () => {
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

    if (hasEffortMetadata) {
      db.exec('ALTER TABLE provider_models ADD COLUMN effort_values TEXT DEFAULT NULL');
      db.exec('ALTER TABLE provider_models ADD COLUMN effort_default TEXT DEFAULT NULL');
      db.prepare('UPDATE provider_models SET effort_values = ?, effort_default = ?')
        .run('["low","high"]', 'high');
    }

    runMigrations(db);
    runMigrations(db); // A second startup must preserve the rebuilt table too.
    const existing = db.prepare('SELECT id, effort_values, effort_default FROM provider_models').get();
    assert.deepEqual(existing, {
      id: 1,
      effort_values: hasEffortMetadata ? '["low","high"]' : null,
      effort_default: hasEffortMetadata ? 'high' : null,
    });

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
}
