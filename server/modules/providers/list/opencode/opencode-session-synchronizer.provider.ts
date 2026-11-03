import fsSync from 'node:fs';
import path from 'node:path';

import Database from 'better-sqlite3';

import { sessionsDb } from '@/modules/database/index.js';
import type { IProviderSessionSynchronizer } from '@/shared/interfaces.js';
import type { OpenCodeSessionTable } from '@/shared/types.js';
import {
  getOpenCodeDatabasePath,
  normalizeProviderTimestamp,
  normalizeSessionName,
  readJsonRecord,
  readOpenCodeLiveSessionTable,
  readOpenCodeSessionTables,
  readOptionalString,
  unwrapJsonStringLiteral,
} from '@/shared/utils.js';

type OpenCodeSessionRow = {
  id: string;
  directory: string | null;
  title: string | null;
  time_created: number | null;
  time_updated: number | null;
  worktree: string | null;
};

type SynchronizeRowsResult = {
  processed: number;
  firstSessionId: string | null;
};

type OpenCodeChildSessionRow = {
  id: string;
};

/**
 * Every session of a database with both session tables once, as its live
 * copy: the row of the two that was updated last, `session_v2` on a tie (see
 * `readOpenCodeLiveSessionTable`). 2.x migrates 1.x sessions a batch at a
 * time with their old timestamps, and a 1.x CLI can still write the 1.x
 * tables after that, so neither table alone lists them all.
 */
const LIVE_SESSION_COPIES_SQL = `(
  SELECT id, project_id, parent_id, directory, title, time_created, time_updated, time_archived
  FROM session v1
  WHERE NOT EXISTS (
    SELECT 1 FROM session_v2 v2
    WHERE v2.id = v1.id
      AND COALESCE(v2.time_updated, v2.time_created, 0) >= COALESCE(v1.time_updated, v1.time_created, 0)
  )
  UNION ALL
  SELECT id, project_id, parent_id, directory, title, time_created, time_updated, time_archived
  FROM session_v2 v2
  WHERE NOT EXISTS (
    SELECT 1 FROM session v1
    WHERE v1.id = v2.id
      AND COALESCE(v1.time_updated, v1.time_created, 0) > COALESCE(v2.time_updated, v2.time_created, 0)
  )
)`;

/**
 * Session indexer for OpenCode's SQLite-backed session store.
 */
export class OpenCodeSessionSynchronizer implements IProviderSessionSynchronizer {
  private readonly provider = 'opencode' as const;
  private childSessionsReconciled = false;

  /**
   * Scans OpenCode's shared opencode.db and upserts active sessions into DB.
   */
  async synchronize(since?: Date): Promise<number> {
    // The first provider-wide scan also reconciles child rows indexed by older versions.
    const result = this.synchronizeRows(since, undefined, !this.childSessionsReconciled);
    return result.processed;
  }

  /**
   * Handles watcher changes for opencode.db.
   */
  async synchronizeFile(filePath: string): Promise<string | null> {
    if (path.basename(filePath) !== 'opencode.db') {
      return null;
    }

    const result = this.synchronizeRows(undefined, 1);
    return result.firstSessionId;
  }

  private synchronizeRows(
    since?: Date,
    limit?: number,
    pruneChildSessions = false,
  ): SynchronizeRowsResult {
    const dbPath = getOpenCodeDatabasePath();
    if (!fsSync.existsSync(dbPath)) {
      return { processed: 0, firstSessionId: null };
    }

    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      // OpenCode 2.x lists sessions in `session_v2`, with the same columns read
      // here; with both tables, each session is read from its live copy.
      const sessionTables = readOpenCodeSessionTables(db);
      const sessionSource = sessionTables.length === 2 ? LIVE_SESSION_COPIES_SQL : (sessionTables[0] ?? 'session');
      if (pruneChildSessions) {
        this.pruneChildSessions(db, sessionSource);
        this.childSessionsReconciled = true;
      }

      const sinceMillis = since?.getTime() ?? null;
      const limitClause = limit ? 'LIMIT ?' : '';
      const params = limit ? [sinceMillis, sinceMillis, limit] : [sinceMillis, sinceMillis];
      const rows = db.prepare(`
        SELECT
          s.id AS id,
          s.directory AS directory,
          s.title AS title,
          s.time_created AS time_created,
          s.time_updated AS time_updated,
          p.worktree AS worktree
        FROM ${sessionSource} s
        LEFT JOIN project p ON p.id = s.project_id
        WHERE s.time_archived IS NULL
          AND s.parent_id IS NULL
          AND (? IS NULL OR COALESCE(s.time_updated, s.time_created, 0) >= ?)
        ORDER BY COALESCE(s.time_updated, s.time_created, 0) DESC, s.id DESC
        ${limitClause}
      `).all(...params) as OpenCodeSessionRow[];

      let processed = 0;
      let firstSessionId: string | null = null;
      for (const row of rows) {
        const indexedSessionId = this.upsertSession(db, row, sessionTables);
        if (!indexedSessionId) {
          continue;
        }

        if (!firstSessionId) {
          firstSessionId = indexedSessionId;
        }
        processed += 1;
      }

      return { processed, firstSessionId };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn('[OpenCodeProvider] Failed to synchronize sessions:', message);
      return { processed: 0, firstSessionId: null };
    } finally {
      db.close();
    }
  }

  private pruneChildSessions(db: Database.Database, sessionSource: string): void {
    const childSessions = db.prepare(`
      SELECT id
      FROM ${sessionSource}
      WHERE parent_id IS NOT NULL
    `).all() as OpenCodeChildSessionRow[];

    for (const childSession of childSessions) {
      sessionsDb.deleteSessionByProviderSessionId(childSession.id, this.provider);
    }
  }

  private upsertSession(
    db: Database.Database,
    row: OpenCodeSessionRow,
    sessionTables: OpenCodeSessionTable[],
  ): string | null {
    const sessionId = readOptionalString(row.id);
    const projectPath = readOptionalString(row.directory) ?? readOptionalString(row.worktree);
    if (!sessionId || !projectPath) {
      return null;
    }

    const fallbackTitle = 'Untitled OpenCode Session';
    const pendingAppSession = sessionsDb.getSessionByProviderSessionId(sessionId)
      ?? sessionsDb.getSessionById(sessionId)
      ?? sessionsDb.findLatestPendingAppSession(this.provider, projectPath);
    if (pendingAppSession && !pendingAppSession.provider_session_id) {
      // Slow networks can let the sqlite watcher index opencode.db before the
      // runtime reports its provider id back through the websocket mapping.
      // Bind that id to the fresh app row first so the watcher does not create
      // a temporary provider-id sidebar entry for the same session.
      sessionsDb.assignProviderSessionId(pendingAppSession.session_id, sessionId);
    }

    // App-created sessions are keyed by an app id, so disk-discovered provider
    // ids must be resolved through the provider-id mapping first.
    const existingSession = sessionsDb.getSessionByProviderSessionId(sessionId)
      ?? sessionsDb.getSessionById(sessionId);
    const existingName = existingSession?.custom_name;

    let nextName: string | undefined;
    if (existingName && existingName !== fallbackTitle) {
      nextName = existingName;
    } else {
      nextName = readOptionalString(row.title) ?? this.readFirstUserText(db, sessionId, sessionTables);
    }

    // OpenCode stores every session in one shared sqlite database, so jsonl_path
    // must stay null to avoid deleting opencode.db when one app session is removed.
    // Return the canonical stored row id so watcher-triggered sidebar updates
    // stay on the app session once provider_session_id has already been mapped.
    return sessionsDb.createSession(
      sessionId,
      this.provider,
      projectPath,
      normalizeSessionName(nextName, fallbackTitle),
      normalizeProviderTimestamp(row.time_created),
      normalizeProviderTimestamp(row.time_updated ?? row.time_created),
      null,
    );
  }

  /**
   * The first prompt of a session, from its live copy's messages, or from the
   * other table's when the live copy has none yet (2.x stores a session
   * before its prompt).
   */
  private readFirstUserText(
    db: Database.Database,
    sessionId: string,
    sessionTables: OpenCodeSessionTable[],
  ): string | undefined {
    const liveTable = readOpenCodeLiveSessionTable(db, sessionId) ?? 'session';
    const otherTable = sessionTables.find((table) => table !== liveTable);
    return this.readFirstUserTextFrom(db, sessionId, liveTable)
      ?? (otherTable ? this.readFirstUserTextFrom(db, sessionId, otherTable) : undefined);
  }

  private readFirstUserTextFrom(
    db: Database.Database,
    sessionId: string,
    sessionTable: OpenCodeSessionTable,
  ): string | undefined {
    try {
      if (sessionTable === 'session_v2') {
        // A 2.x user message keeps its prompt in `data.text`. It is decoded
        // like a 1.x one below: migrated 1.x prompts keep their JSON quotes.
        const text = readOptionalString(db.prepare(`
          SELECT json_extract(data, '$.text')
          FROM session_message
          WHERE session_id = ? AND type = 'user'
          ORDER BY seq
          LIMIT 1
        `).pluck().get(sessionId));
        return text === undefined ? undefined : unwrapJsonStringLiteral(text);
      }

      const row = db.prepare(`
        SELECT p.data AS data
        FROM message m
        INNER JOIN part p
          ON p.session_id = m.session_id
         AND p.message_id = m.id
        WHERE m.session_id = ?
          AND json_extract(m.data, '$.role') = 'user'
          AND json_extract(p.data, '$.type') = 'text'
        ORDER BY COALESCE(m.time_created, 0), COALESCE(p.time_created, 0)
        LIMIT 1
      `).get(sessionId) as { data: string | null } | undefined;

      const data = readJsonRecord(row?.data);
      const text = readOptionalString(data?.text);
      // OpenCode persists the first prompt as a JSON string literal (e.g.
      // `"hello"`), so decode it to avoid titling the session with quotes.
      return text === undefined ? undefined : unwrapJsonStringLiteral(text);
    } catch {
      return undefined;
    }
  }
}
