import type Database from 'better-sqlite3';

import { readJsonRecord, readOptionalString, unwrapJsonStringLiteral } from '@/shared/utils.js';

import { SqliteSessionSynchronizer } from '../../shared/sessions/sqlite-session-synchronizer.provider.js';

import { getOpenCodeDatabasePath } from './opencode-data-root.js';

type OpenCodeSessionRow = {
  id: string;
  directory: string | null;
  title: string | null;
  time_created: number | null;
  time_updated: number | null;
  worktree: string | null;
};

/**
 * Session indexer for OpenCode's SQLite-backed session store.
 *
 * Contributes OpenCode's row mapping to the shared SQLite synchronizer
 * skeleton: active (non-archived) sessions joined with their project row,
 * `directory` with `worktree` fallback as project path, and titles that fall
 * back to the session's first user text when OpenCode stored none.
 */
export class OpenCodeSessionSynchronizer extends SqliteSessionSynchronizer<OpenCodeSessionRow> {
  protected readonly fallbackTitle = 'Untitled OpenCode Session';
  protected readonly logTag = '[OpenCodeProvider]';
  protected readonly watchedFileBasenames = ['opencode.db', 'opencode.db-wal'];

  constructor() {
    super('opencode');
  }

  protected getDatabasePath(): string {
    return getOpenCodeDatabasePath();
  }

  protected selectSessionRows(
    db: Database.Database,
    sinceMillis: number | null,
    limit: number | null,
  ): OpenCodeSessionRow[] {
    return db.prepare(`
      SELECT
        s.id AS id,
        s.directory AS directory,
        s.title AS title,
        s.time_created AS time_created,
        s.time_updated AS time_updated,
        p.worktree AS worktree
      FROM session s
      LEFT JOIN project p ON p.id = s.project_id
      WHERE s.time_archived IS NULL
        AND (? IS NULL OR COALESCE(s.time_updated, s.time_created, 0) > ?)
      ORDER BY COALESCE(s.time_updated, s.time_created, 0) DESC, s.id DESC
      ${limit === null ? '' : 'LIMIT ?'}
    `).all(...(limit === null
      ? [sinceMillis, sinceMillis]
      : [sinceMillis, sinceMillis, limit])) as OpenCodeSessionRow[];
  }

  protected getRowTimestampsMs(row: OpenCodeSessionRow): { createdAtMs: number; updatedAtMs: number } {
    return {
      createdAtMs: row.time_created ?? 0,
      updatedAtMs: row.time_updated ?? row.time_created ?? 0,
    };
  }

  protected getProjectPath(row: OpenCodeSessionRow): string | null {
    return readOptionalString(row.directory) ?? readOptionalString(row.worktree) ?? null;
  }

  protected deriveSessionName(db: Database.Database, row: OpenCodeSessionRow): string | null {
    return readOptionalString(row.title) ?? this.readFirstUserText(db, row.id) ?? null;
  }

  /**
   * Reads the session's first user text as a title fallback.
   */
  private readFirstUserText(db: Database.Database, sessionId: string): string | undefined {
    try {
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
