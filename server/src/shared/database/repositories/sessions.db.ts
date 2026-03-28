import { workspaceOriginalPathsDb } from '@/shared/database/repositories/workspace-original-paths.db.js';
import { getConnection } from '@/shared/database/connection.js';
import type { SessionWithSummary } from '@/shared/database/types.js';

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

type SessionNameLookupRow = {
    session_id: string;
    custom_name: string;
};

function normalizeTimestamp(value?: string): string | null {
    if (!value) return null;

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        return null;
    }

    return parsed.toISOString();
}

export const sessionsDb = {

    createSession(
        session_id: string,
        provider: string,
        workspacePath: string,
        customName?: string,
        createdAt?: string,
        updatedAt?: string,
    ): void {
        const db = getConnection();
        const createdAtValue = normalizeTimestamp(createdAt);
        const updatedAtValue = normalizeTimestamp(updatedAt);

        // First, ensure the workspace path is recorded in the workspace_original_paths table
        // since it's a foreign key in the sessions table.
        workspaceOriginalPathsDb.createWorkspacePath(workspacePath);

        db.prepare(
            `INSERT INTO sessions (session_id, provider, custom_name, workspace_path, created_at, updated_at)
             VALUES (?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), COALESCE(?, CURRENT_TIMESTAMP))
             ON CONFLICT(session_id) DO UPDATE SET updated_at = excluded.updated_at
             WHERE sessions.provider = excluded.provider`
        ).run(session_id, provider, customName, workspacePath, createdAtValue, updatedAtValue);
    },

    /** Updates a custom session name for an existing session row. */
    createSessionName(sessionId: string, provider: string, customName: string): void {
        const db = getConnection();
        db.prepare(
            `UPDATE sessions
             SET custom_name = ?, updated_at = CURRENT_TIMESTAMP
             WHERE session_id = ? AND provider = ?`
        ).run(customName, sessionId, provider);
    },

    getSessionName(sessionId: string, provider: string): string | null {
        const db = getConnection();
        const row = db
            .prepare(
                `SELECT custom_name
                 FROM sessions
                 WHERE session_id = ? AND provider = ?`
            )
            .get(sessionId, provider) as { custom_name: string | null } | undefined;

        return row?.custom_name ?? null;
    },

    getSessionNames(sessionIds: string[], provider: string): Map<string, string> {
        if (sessionIds.length === 0) return new Map();

        const db = getConnection();
        const placeholders = sessionIds.map(() => '?').join(',');
        const rows = db
            .prepare(
                `SELECT session_id, custom_name
                 FROM sessions
                 WHERE session_id IN (${placeholders})
                   AND provider = ?
                   AND custom_name IS NOT NULL`
            )
            .all(...sessionIds, provider) as SessionNameLookupRow[];

        return new Map(rows.map((row) => [row.session_id, row.custom_name]));
    },

    deleteSession(session_id: string): void {
        const db = getConnection();
        db.prepare('DELETE FROM sessions WHERE session_id = ?').run(session_id);
    },

    applyCustomSessionNames(sessions: SessionWithSummary[] | undefined | null, provider: string): void {
        if (!sessions?.length) return;

        const ids = sessions.map((session) => session.id);
        const customNames = sessionsDb.getSessionNames(ids, provider);

        for (const session of sessions) {
            const customName = customNames.get(session.id);
            if (customName) {
                session.summary = customName;
            }
        }
    },
};

