/**
 * Antigravity Session Synchronizer Provider
 *
 * Implements IProviderSessionSynchronizer for Antigravity.
 * Scans `~/.gemini/antigravity-cli/conversation_summaries.db` and synchronizes
 * session metadata into CloudCLI's SQLite sessions index.
 *
 * @module antigravity-session-synchronizer.provider
 */

import fsSync from 'node:fs';
import path from 'node:path';

import Database from 'better-sqlite3';

import { sessionsDb } from '@/modules/database/index.js';
import type { IProviderSessionSynchronizer } from '@/shared/interfaces.js';
import type { LLMProvider } from '@/shared/types.js';
import {
  normalizeProviderTimestamp,
  normalizeSessionName,
  readOptionalString,
} from '@/shared/utils.js';

import { getAntigravitySummariesDbPath } from './antigravity-data-root.js';

const PROVIDER: LLMProvider = 'antigravity';

type AntigravitySummaryRow = {
  conversation_id: string;
  title: string | null;
  workspace_uris: string | null;
  last_modified_time: string | null;
  status: string | null;
};

/**
 * Parses workspace directory from JSON array like `["file:///Users/azrael/workspaces/cloudcli"]`.
 */
function parseWorkspacePath(workspaceUris: string | null): string | null {
  if (!workspaceUris) return null;

  try {
    const uris = JSON.parse(workspaceUris);
    if (Array.isArray(uris) && uris.length > 0) {
      const firstUri = uris[0];
      if (typeof firstUri === 'string') {
        if (firstUri.startsWith('file://')) {
          return decodeURIComponent(firstUri.slice(7));
        }
        return firstUri;
      }
    }
  } catch {
    // If not JSON, check if it's a direct path
    if (workspaceUris.startsWith('file://')) {
      return decodeURIComponent(workspaceUris.slice(7));
    }
    if (workspaceUris.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(workspaceUris)) {
      return workspaceUris;
    }
  }

  return null;
}

export class AntigravitySessionSynchronizer implements IProviderSessionSynchronizer {
  private highWaterMarkLastModified: number = 0;

  /**
   * Scans Antigravity conversation_summaries.db and upserts discovered sessions.
   */
  async synchronize(since?: Date): Promise<number> {
    const sinceTime = since ? since.getTime() : null;
    const result = this.queryUpdatedSessions(sinceTime, null);
    return result.processedCount;
  }

  /**
   * Handles watcher change notifications for conversation_summaries.db.
   */
  async synchronizeFile(filePath: string): Promise<string | null> {
    const fileName = path.basename(filePath);

    if (fileName !== 'conversation_summaries.db' && fileName !== 'conversation_summaries.db-wal') {
      return null;
    }

    const sinceMillis = this.highWaterMarkLastModified > 0 ? this.highWaterMarkLastModified : null;
    const result = this.queryUpdatedSessions(sinceMillis, 50);
    return result.firstSessionId;
  }

  /**
   * Queries and synchronizes sessions from conversation_summaries.db.
   */
  private queryUpdatedSessions(
    sinceMillis: number | null,
    limit: number | null,
  ): { processedCount: number; firstSessionId: string | null } {
    const dbPath = getAntigravitySummariesDbPath();
    if (!fsSync.existsSync(dbPath)) {
      return { processedCount: 0, firstSessionId: null };
    }

    let db: Database.Database | null = null;

    try {
      db = new Database(dbPath, { readonly: true, fileMustExist: true });

      const query = `
        SELECT
          conversation_id,
          title,
          workspace_uris,
          last_modified_time,
          status
        FROM conversation_summaries
        ORDER BY last_modified_time DESC
        ${limit === null ? '' : 'LIMIT ?'}
      `;

      const rows = (limit === null
        ? db.prepare(query).all()
        : db.prepare(query).all(limit)) as AntigravitySummaryRow[];

      let processedCount = 0;
      let firstSessionId: string | null = null;

      for (const row of rows) {
        const sessionId = readOptionalString(row.conversation_id);
        if (!sessionId) continue;

        const rowTime = row.last_modified_time
          ? new Date(row.last_modified_time).getTime()
          : 0;

        if (sinceMillis && rowTime <= sinceMillis) {
          continue;
        }

        const projectPath = parseWorkspacePath(row.workspace_uris) ?? process.cwd();
        const fallbackTitle = 'Untitled Antigravity Session';
        const title = readOptionalString(row.title) || fallbackTitle;

        const pendingAppSession = sessionsDb.getSessionByProviderSessionId(sessionId)
          ?? sessionsDb.getSessionById(sessionId)
          ?? sessionsDb.findLatestPendingAppSession(PROVIDER, projectPath);

        if (pendingAppSession && !pendingAppSession.provider_session_id) {
          sessionsDb.assignProviderSessionId(pendingAppSession.session_id, sessionId);
        }

        const existingSession = sessionsDb.getSessionByProviderSessionId(sessionId)
          ?? sessionsDb.getSessionById(sessionId);
        const existingName = existingSession?.custom_name;

        const nextName = existingName && existingName !== fallbackTitle
          ? existingName
          : title;

        const createdSessionId = sessionsDb.createSession(
          sessionId,
          PROVIDER,
          projectPath,
          normalizeSessionName(nextName, fallbackTitle),
          normalizeProviderTimestamp(rowTime || Date.now()),
          normalizeProviderTimestamp(rowTime || Date.now()),
          null, // jsonl_path is null for DB-backed session indices
        );

        if (createdSessionId) {
          processedCount += 1;
          firstSessionId ??= createdSessionId;
        }

        if (rowTime > this.highWaterMarkLastModified) {
          this.highWaterMarkLastModified = rowTime;
        }
      }

      return { processedCount, firstSessionId };
    } catch (error) {
      console.warn('[AntigravitySessionSynchronizer] Sync failed:', error);
      return { processedCount: 0, firstSessionId: null };
    } finally {
      if (db) {
        db.close();
      }
    }
  }
}
