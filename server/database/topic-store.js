/**
 * Phase 4 — conversation_topics persistence.
 *
 * Wraps the better-sqlite3 connection from db.js with topic-specific helpers.
 * The CREATE TABLE is mirrored from migrations/001_conversation_topics.sql and
 * runs once on import (there is no migration runner — db.js follows the same
 * "exec at boot" pattern). All public methods return plain objects suitable
 * for direct JSON serialization in the routes layer.
 */

import fs from 'node:fs';
import path from 'node:path';

import { getModuleDir } from '../utils/runtime-paths.js';

import { db } from './db.js';

const PASTEL_CYCLE = ['sky', 'mint', 'peach', 'lavender', 'butter', 'blush'];

let initialized = false;

function ensureTable() {
  if (initialized) return;
  try {
    const migrationPath = path.join(
      getModuleDir(import.meta.url),
      'migrations',
      '001_conversation_topics.sql',
    );
    const sql = fs.readFileSync(migrationPath, 'utf8');
    db.exec(sql);
  } catch (err) {
    // Inline fallback so we still create the table when the SQL file is missing
    // (e.g. minimal install layouts). Keep schema in sync with the .sql file.
    console.warn(`[topic-store] migration file unreadable, using inline DDL: ${err.message}`);
    db.exec(`
      CREATE TABLE IF NOT EXISTS conversation_topics (
        session_id TEXT NOT NULL,
        provider TEXT NOT NULL DEFAULT 'claude',
        project_key TEXT NOT NULL,
        topic TEXT NOT NULL,
        accent TEXT,
        assigned_at INTEGER NOT NULL,
        method TEXT NOT NULL,
        PRIMARY KEY (session_id, provider)
      );
      CREATE INDEX IF NOT EXISTS idx_ct_project ON conversation_topics(project_key);
      CREATE INDEX IF NOT EXISTS idx_ct_topic_project ON conversation_topics(project_key, topic);
    `);
  }
  initialized = true;
}

ensureTable();

function rowToAssignment(row) {
  if (!row) return null;
  return {
    sessionId: row.session_id,
    provider: row.provider,
    projectKey: row.project_key,
    topic: row.topic,
    accent: row.accent || null,
    assignedAt: row.assigned_at,
    method: row.method,
  };
}

export const topicStore = {
  /** Returns the topic row for a single session, or null. */
  getForSession(sessionId, provider = 'claude') {
    const row = db
      .prepare(
        'SELECT * FROM conversation_topics WHERE session_id = ? AND provider = ?',
      )
      .get(sessionId, provider);
    return rowToAssignment(row);
  },

  /** All topic rows for a project, in stable assigned_at order. */
  getForProject(projectKey) {
    const rows = db
      .prepare(
        'SELECT * FROM conversation_topics WHERE project_key = ? ORDER BY assigned_at ASC',
      )
      .all(projectKey);
    return rows.map(rowToAssignment);
  },

  /** Distinct (topic, accent) pairs with member count, scoped to a project. */
  getTopicsForProject(projectKey) {
    const rows = db
      .prepare(
        `SELECT topic, accent, COUNT(*) AS session_count, MIN(assigned_at) AS first_seen
         FROM conversation_topics
         WHERE project_key = ?
         GROUP BY topic, accent
         ORDER BY first_seen ASC`,
      )
      .all(projectKey);
    return rows.map((r) => ({
      name: r.topic,
      accent: r.accent || null,
      sessionCount: r.session_count,
      firstSeen: r.first_seen,
    }));
  },

  /** All assignments across all projects. Used for the sidebar bootstrap fetch. */
  getAll() {
    const rows = db
      .prepare('SELECT * FROM conversation_topics ORDER BY project_key, assigned_at ASC')
      .all();
    return rows.map(rowToAssignment);
  },

  /** Set of session_ids that already have any topic, scoped to a project. */
  getTaggedSessionIds(projectKey) {
    const rows = db
      .prepare(
        'SELECT session_id FROM conversation_topics WHERE project_key = ?',
      )
      .all(projectKey);
    return new Set(rows.map((r) => r.session_id));
  },

  /** Pick the next pastel color for a new topic in a project (round-robin). */
  pickAccentForProject(projectKey) {
    const rows = db
      .prepare(
        'SELECT DISTINCT accent FROM conversation_topics WHERE project_key = ? AND accent IS NOT NULL',
      )
      .all(projectKey);
    const used = new Set(rows.map((r) => r.accent));
    for (const color of PASTEL_CYCLE) {
      if (!used.has(color)) return color;
    }
    // All pastels used — recycle by least-recent topic.
    const fallback = db
      .prepare(
        `SELECT accent FROM conversation_topics
         WHERE project_key = ? AND accent IS NOT NULL
         GROUP BY accent
         ORDER BY MIN(assigned_at) ASC LIMIT 1`,
      )
      .get(projectKey);
    return fallback?.accent || PASTEL_CYCLE[0];
  },

  /** Look up the accent already used for a topic name in a project, if any. */
  findAccentForTopic(projectKey, topic) {
    const row = db
      .prepare(
        `SELECT accent FROM conversation_topics
         WHERE project_key = ? AND topic = ? AND accent IS NOT NULL
         LIMIT 1`,
      )
      .get(projectKey, topic);
    return row?.accent || null;
  },

  /**
   * Insert or replace a topic assignment. If `accent` is undefined, reuses the
   * existing accent for that (project, topic) or assigns a fresh one.
   */
  setTopic({ sessionId, provider = 'claude', projectKey, topic, accent, method }) {
    if (!sessionId || !projectKey || !topic || !method) {
      throw new Error('topicStore.setTopic requires sessionId, projectKey, topic, method');
    }
    let resolvedAccent = accent;
    if (resolvedAccent === undefined) {
      resolvedAccent =
        this.findAccentForTopic(projectKey, topic) || this.pickAccentForProject(projectKey);
    }
    const assignedAt = Date.now();
    db.prepare(
      `INSERT INTO conversation_topics (session_id, provider, project_key, topic, accent, assigned_at, method)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(session_id, provider) DO UPDATE SET
         project_key = excluded.project_key,
         topic = excluded.topic,
         accent = excluded.accent,
         assigned_at = excluded.assigned_at,
         method = excluded.method`,
    ).run(sessionId, provider, projectKey, topic, resolvedAccent, assignedAt, method);
    return {
      sessionId,
      provider,
      projectKey,
      topic,
      accent: resolvedAccent,
      assignedAt,
      method,
    };
  },

  /** Bulk write — used by the HDBSCAN clusterer to atomically replace tags. */
  replaceForProject(projectKey, assignments, { preserveManual = true } = {}) {
    const txn = db.transaction((rows) => {
      if (preserveManual) {
        db.prepare(
          'DELETE FROM conversation_topics WHERE project_key = ? AND method != ?',
        ).run(projectKey, 'manual');
      } else {
        db.prepare('DELETE FROM conversation_topics WHERE project_key = ?').run(projectKey);
      }
      const insert = db.prepare(
        `INSERT OR REPLACE INTO conversation_topics
         (session_id, provider, project_key, topic, accent, assigned_at, method)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const r of rows) {
        if (preserveManual) {
          const existing = db
            .prepare(
              'SELECT method FROM conversation_topics WHERE session_id = ? AND provider = ?',
            )
            .get(r.sessionId, r.provider || 'claude');
          if (existing?.method === 'manual') continue;
        }
        insert.run(
          r.sessionId,
          r.provider || 'claude',
          projectKey,
          r.topic,
          r.accent || null,
          r.assignedAt || Date.now(),
          r.method,
        );
      }
    });
    txn(assignments);
  },

  /** Drop a single assignment (used when a user clears a manual tag). */
  clearForSession(sessionId, provider = 'claude') {
    return (
      db
        .prepare('DELETE FROM conversation_topics WHERE session_id = ? AND provider = ?')
        .run(sessionId, provider).changes > 0
    );
  },
};

export const __internal = { ensureTable, PASTEL_CYCLE };
