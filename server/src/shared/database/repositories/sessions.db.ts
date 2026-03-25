import { workspaceOriginalPathsDb } from '@/shared/database/repositories/workspace-original-paths.db.js';
import { getConnection } from '@/shared/database/connection.js';
import type {
    SessionNameLookupRow,
    SessionWithSummary,
} from '@/shared/database/types.js';
import { logger } from '@/shared/utils/logger.js';

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export const sessionsDb = {

    createSession(session_id: string, provider: string, workspacePath: string, customName?: string): void {
        const db = getConnection();

        // First, ensure the workspace path is recorded in the workspace_original_paths table
        // since it's a foreign key in the sessions table.
        workspaceOriginalPathsDb.createWorkspacePath(workspacePath);

        db.prepare(
            'INSERT OR IGNORE INTO sessions (session_id, provider, custom_name, workspace_path) VALUES (?, ?, ?, ?)'
        ).run(session_id, provider, customName, workspacePath);
    },

    deleteSession(session_id: string): void {
        const db = getConnection();
        db.prepare('DELETE FROM sessions WHERE session_id = ?').run(session_id);
    }


    // /** Inserts or updates a custom session name (upsert on session_id + provider). */
    // setName(sessionId: string, provider: string, customName: string): void {
    //   const db = getConnection();
    //   db.prepare(
    //     `INSERT INTO session_names (session_id, provider, custom_name)
    //      VALUES (?, ?, ?)
    //      ON CONFLICT(session_id, provider)
    //      DO UPDATE SET custom_name = excluded.custom_name,
    //                    updated_at = CURRENT_TIMESTAMP`
    //   ).run(sessionId, provider, customName);
    // },

    /** Returns the custom name for a single session, or null if unset. */
    // getName(sessionId: string, provider: string): string | null {
    //   const db = getConnection();
    //   const row = db
    //     .prepare(
    //       'SELECT custom_name FROM session_names WHERE session_id = ? AND provider = ?'
    //     )
    //     .get(sessionId, provider) as { custom_name: string } | undefined;
    //   return row?.custom_name ?? null;
    // },

    /**
     * Batch lookup for multiple session IDs.
     * Returns a Map<sessionId, customName> for efficient overlay onto session lists.
     */
    // getNames(sessionIds: string[], provider: string): Map<string, string> {
    //   if (sessionIds.length === 0) return new Map();

    //   const db = getConnection();
    //   const placeholders = sessionIds.map(() => '?').join(',');
    //   const rows = db
    //     .prepare(
    //       `SELECT session_id, custom_name FROM session_names
    //        WHERE session_id IN (${placeholders}) AND provider = ?`
    //     )
    //     .all(...sessionIds, provider) as SessionNameLookupRow[];

    //   return new Map(rows.map((r) => [r.session_id, r.custom_name]));
    // },

    /** Removes a custom session name. Returns true if a row was deleted. */
    // deleteName(sessionId: string, provider: string): boolean {
    //   const db = getConnection();
    //   return (
    //     db
    //       .prepare(
    //         'DELETE FROM session_names WHERE session_id = ? AND provider = ?'
    //       )
    //       .run(sessionId, provider).changes > 0
    //   );
    // },
};

