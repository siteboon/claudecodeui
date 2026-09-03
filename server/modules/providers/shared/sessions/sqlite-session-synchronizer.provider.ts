/**
 * SQLite Session Synchronizer Base Class
 *
 * Template-method base for providers whose sessions are indexed in one shared
 * SQLite database (zcode, antigravity, opencode). It owns the scan skeleton
 * the three implementations used to duplicate: watch-file filtering, the
 * high-water-mark incremental cursor, the short read-only connection
 * discipline, the pending-app-session binding protocol, custom-name
 * preservation, and the createSession upsert.
 *
 * Adapters contribute only what is genuinely provider-specific: the database
 * path, the row-selection SQL, and the row → session-metadata mapping.
 *
 * @module sqlite-session-synchronizer
 */

import fsSync from 'node:fs';
import path from 'node:path';

import Database from 'better-sqlite3';

import { sessionsDb } from '@/modules/database/index.js';
import type { IProviderSessionSynchronizer } from '@/shared/interfaces.js';
import type { LLMProvider, ProviderSessionWatchTarget } from '@/shared/types.js';
import { normalizeProviderTimestamp, normalizeSessionName, readOptionalString } from '@/shared/utils.js';

/**
 * Minimal row contract every adapter's SQL must satisfy; adapters declare
 * their full row shape against it.
 */
export type SqliteSynchronizerRow = {
  id: unknown;
  title: unknown;
};

/**
 * Template-method base for SQLite-backed session synchronizers.
 *
 * Consumers: zcode, antigravity, and opencode session synchronizers. Follows
 * the shared McpProvider/SkillsProvider style: public template methods,
 * protected abstract hooks for provider data, and protected concrete helpers
 * for the cross-provider protocol.
 */
export abstract class SqliteSessionSynchronizer<Row extends SqliteSynchronizerRow>
  implements IProviderSessionSynchronizer
{
  /** Cap for watcher-triggered incremental syncs; debouncing absorbs burst writes. */
  protected readonly incrementalSyncLimit = 100;

  /** Title used when the provider row and the app DB both name nothing. */
  protected abstract readonly fallbackTitle: string;

  /** Log tag prefixing scan failures (e.g. '[ZCodeProvider]'). */
  protected abstract readonly logTag: string;

  /** Watched artifact file names; also drives `getSessionWatchTarget`. */
  protected abstract readonly watchedFileBasenames: string[];

  /**
   * High-water mark of the latest row timestamp seen; incremental syncs read
   * only strictly newer rows.
   */
  private highWaterMark = 0;

  protected constructor(private readonly provider: LLMProvider) {}

  /**
   * Derives the watch target from the adapter's own facts: the directory
   * holding the provider database, and the watched artifact names.
   */
  getSessionWatchTarget(): ProviderSessionWatchTarget {
    return {
      rootPath: path.dirname(this.getDatabasePath()),
      isTargetFile: (filePath: string) =>
        this.watchedFileBasenames.includes(path.basename(filePath)),
    };
  }

  /**
   * Full scan: selects all rows (optionally filtered server-side by the
   * adapter's SQL) and upserts each one.
   */
  async synchronize(since?: Date): Promise<number> {
    const result = this.queryUpdatedSessions(since?.getTime() ?? null, null);
    return result.processedCount;
  }

  /**
   * Watcher-triggered incremental sync: only rows strictly newer than the
   * high-water mark, capped at `incrementalSyncLimit` most-recent rows.
   */
  async synchronizeFile(filePath: string): Promise<string | null> {
    if (!this.getSessionWatchTarget().isTargetFile(filePath)) {
      return null;
    }

    const sinceMillis = this.highWaterMark > 0 ? this.highWaterMark : null;
    const result = this.queryUpdatedSessions(sinceMillis, this.incrementalSyncLimit);
    return result.firstSessionId;
  }

  /** Absolute path of the provider's SQLite session database. */
  protected abstract getDatabasePath(): string;

  /**
   * Selects the session rows to process. Adapters may pre-filter `sinceMillis`
   * in SQL; the base class re-applies the same strict `newer-than` filter per
   * row via `getRowTimestampsMs`, so an adapter that ignores `sinceMillis`
   * here still gets correct incremental semantics.
   */
  protected abstract selectSessionRows(
    db: Database.Database,
    sinceMillis: number | null,
    limit: number | null,
  ): Row[];

  /**
   * Row timestamps in epoch milliseconds; `updatedAtMs` drives the incremental
   * since-filter and the high-water mark.
   */
  protected abstract getRowTimestampsMs(row: Row): { createdAtMs: number; updatedAtMs: number };

  /** Workspace path recorded for the session, or null to skip the row. */
  protected abstract getProjectPath(row: Row): string | null;

  /**
   * Title derived from the provider row. `db` is open for adapters that fall
   * back to reading session content (opencode's first user text).
   */
  protected abstract deriveSessionName(db: Database.Database, row: Row): string | null;

  /**
   * Extracts the provider-native session id from a row. Adapters may override
   * to add defensive filtering (zcode's subagent-prefix double-check).
   */
  protected getSessionId(row: Row): string | null {
    return readOptionalString(row.id) ?? null;
  }

  /**
   * Shared scan step: opens a short read-only connection, selects and filters
   * rows, upserts each, and advances the high-water mark. Never throws.
   */
  protected queryUpdatedSessions(
    sinceMillis: number | null,
    limit: number | null,
  ): { processedCount: number; firstSessionId: string | null } {
    const dbPath = this.getDatabasePath();
    if (!fsSync.existsSync(dbPath)) {
      return { processedCount: 0, firstSessionId: null };
    }

    let db: Database.Database | null = null;
    try {
      db = new Database(dbPath, { readonly: true, fileMustExist: true });
      const rows = this.selectSessionRows(db, sinceMillis, limit);

      let processedCount = 0;
      let firstSessionId: string | null = null;
      for (const row of rows) {
        const { updatedAtMs } = this.getRowTimestampsMs(row);
        if (sinceMillis !== null && updatedAtMs <= sinceMillis) {
          continue;
        }

        const sessionId = this.upsertSession(db, row);
        if (sessionId) {
          processedCount += 1;
          firstSessionId ??= sessionId;
        }

        if (updatedAtMs > this.highWaterMark) {
          this.highWaterMark = updatedAtMs;
        }
      }

      return { processedCount, firstSessionId };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`${this.logTag} Failed to synchronize sessions:`, message);
      return { processedCount: 0, firstSessionId: null };
    } finally {
      if (db) {
        db.close();
      }
    }
  }

  /**
   * Upserts one provider row: binds pending app sessions, preserves custom
   * names, and writes the normalized session row.
   */
  private upsertSession(db: Database.Database, row: Row): string | null {
    const sessionId = this.getSessionId(row);
    if (!sessionId) {
      return null;
    }

    const projectPath = this.getProjectPath(row);
    if (!projectPath) {
      return null;
    }

    this.bindPendingAppSession(sessionId, projectPath);

    const derivedName = this.deriveSessionName(db, row);
    const nextName = this.resolveSessionName(sessionId, derivedName);
    const { createdAtMs, updatedAtMs } = this.getRowTimestampsMs(row);

    return sessionsDb.createSession(
      sessionId,
      this.provider,
      projectPath,
      normalizeSessionName(nextName ?? undefined, this.fallbackTitle),
      normalizeProviderTimestamp(createdAtMs),
      normalizeProviderTimestamp(updatedAtMs),
      this.resolveJsonlPath(row),
    );
  }

  /**
   * Binds a provider-discovered session id to a pending app session when one
   * is waiting for it.
   *
   * Slow networks can let the sqlite watcher index the provider database
   * before the runtime reports its provider id back through the websocket
   * mapping. Binding that id to the fresh app row first keeps the watcher
   * from creating a temporary provider-id sidebar entry for the same session.
   */
  private bindPendingAppSession(sessionId: string, projectPath: string): void {
    const pendingAppSession = sessionsDb.getSessionByProviderSessionId(sessionId)
      ?? sessionsDb.getSessionById(sessionId)
      ?? sessionsDb.findLatestPendingAppSession(this.provider, projectPath);

    if (pendingAppSession && !pendingAppSession.provider_session_id) {
      sessionsDb.assignProviderSessionId(pendingAppSession.session_id, sessionId);
    }
  }

  /**
   * Preserves an existing custom session name; otherwise uses the derived
   * name (adapters may fall back to content, e.g. opencode's first user text).
   */
  private resolveSessionName(sessionId: string, derivedName: string | null): string | null {
    const existingSession = sessionsDb.getSessionByProviderSessionId(sessionId)
      ?? sessionsDb.getSessionById(sessionId);
    const existingName = existingSession?.custom_name;

    if (existingName && existingName !== this.fallbackTitle) {
      return existingName;
    }
    return derivedName ?? this.fallbackTitle;
  }

  /**
   * Transcript path recorded on the session row. Defaults to null: providers
   * sharing one SQLite database must not point `jsonl_path` at it, or deleting
   * a single app session could delete the whole store. Antigravity overrides
   * this to probe its per-session brain directory.
   */
  protected resolveJsonlPath(_row: Row): string | null {
    return null;
  }
}
