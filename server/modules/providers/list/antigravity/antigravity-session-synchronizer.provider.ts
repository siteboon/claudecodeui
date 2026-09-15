import fsSync from 'node:fs';

import type Database from 'better-sqlite3';

import {
  parseAntigravityWorkspacePath,
  readOptionalString,
  sanitizeLeafDirectoryName,
} from '@/shared/utils.js';

import { SqliteSessionSynchronizer } from '../../shared/sessions/sqlite-session-synchronizer.provider.js';

import {
  getAntigravitySummariesDbPath,
  getAntigravityTranscriptCandidates,
} from './antigravity-data-root.js';

type AntigravitySummaryRow = {
  id: string;
  title: string | null;
  workspace_uris: string | null;
  last_modified_time: string | null;
};

/**
 * Session synchronizer for Antigravity's conversation_summaries.db.
 *
 * Contributes Antigravity's row mapping to the shared SQLite synchronizer
 * skeleton: the workspace is decoded from `workspace_uris` (falling back to
 * the process cwd), `last_modified_time` is an ISO string, and each session
 * row carries the path of its per-session brain transcript via
 * `resolveJsonlPath`.
 */
export class AntigravitySessionSynchronizer extends SqliteSessionSynchronizer<AntigravitySummaryRow> {
  protected readonly fallbackTitle = 'Untitled Antigravity Session';
  protected readonly logTag = '[AntigravitySessionSynchronizer]';
  protected readonly watchedFileBasenames = [
    'conversation_summaries.db',
    'conversation_summaries.db-wal',
  ];

  constructor() {
    super('antigravity');
  }

  protected getDatabasePath(): string {
    return getAntigravitySummariesDbPath();
  }

  protected selectSessionRows(
    db: Database.Database,
    _sinceMillis: number | null,
    limit: number | null,
  ): AntigravitySummaryRow[] {
    // The summaries table has no filterable timestamp column in SQL; the
    // shared skeleton applies the since filter per row after parsing the
    // ISO `last_modified_time`.
    const query = `
      SELECT
        conversation_id AS id,
        title,
        workspace_uris,
        last_modified_time
      FROM conversation_summaries
      ORDER BY last_modified_time DESC
      ${limit === null ? '' : 'LIMIT ?'}
    `;

    return (limit === null
      ? db.prepare(query).all()
      : db.prepare(query).all(limit)) as AntigravitySummaryRow[];
  }

  protected getRowTimestampsMs(row: AntigravitySummaryRow): { createdAtMs: number; updatedAtMs: number } {
    const rowTime = row.last_modified_time
      ? new Date(row.last_modified_time).getTime()
      : 0;
    return {
      createdAtMs: rowTime || Date.now(),
      updatedAtMs: rowTime || Date.now(),
    };
  }

  protected getProjectPath(row: AntigravitySummaryRow): string | null {
    return parseAntigravityWorkspacePath(row.workspace_uris) ?? process.cwd();
  }

  protected deriveSessionName(_db: Database.Database, row: AntigravitySummaryRow): string | null {
    return readOptionalString(row.title) ?? null;
  }

  /**
   * Antigravity stores one transcript per session under its brain directory,
   * so the session row can safely point at it (unlike the shared-SQLite
   * providers where jsonl_path must stay null).
   */
  protected resolveJsonlPath(row: AntigravitySummaryRow): string | null {
    const sessionId = readOptionalString(row.id);
    if (!sessionId) {
      return null;
    }

    try {
      const safeId = sanitizeLeafDirectoryName(sessionId, 'antigravity session id');
      for (const candidate of getAntigravityTranscriptCandidates(safeId)) {
        if (fsSync.existsSync(candidate)) {
          return candidate;
        }
      }
    } catch {
      // Keep null when sanitization fails.
    }

    return null;
  }
}
