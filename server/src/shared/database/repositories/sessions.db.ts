import { workspaceOriginalPathsDb } from '@/shared/database/repositories/workspace-original-paths.db.js';
import { getConnection } from '@/shared/database/connection.js';
import path from 'node:path';
import type { SessionsRow, SessionWithSummary } from '@/shared/database/types.js';

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

type SessionNameLookupRow = {
    session_id: string;
    custom_name: string;
};

type SessionMetadataLookupRow = Pick<
    SessionsRow,
    'session_id' | 'provider' | 'workspace_path' | 'jsonl_path' | 'created_at' | 'updated_at'
>;

function normalizeTimestamp(value?: string): string | null {
    if (!value) return null;

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        return null;
    }

    return parsed.toISOString();
}

function normalizeCodexWorkspacePath(workspacePath: string): string {
    const trimmedPath = workspacePath.trim();
    if (!trimmedPath) {
        return workspacePath;
    }

    if (process.platform !== 'win32') {
        return path.normalize(trimmedPath);
    }

    let strippedPath = trimmedPath;
    if (strippedPath.startsWith('\\\\?\\UNC\\')) {
        strippedPath = `\\\\${strippedPath.slice('\\\\?\\UNC\\'.length)}`;
    } else if (strippedPath.startsWith('\\\\?\\')) {
        strippedPath = strippedPath.slice('\\\\?\\'.length);
    }

    return path.win32.normalize(strippedPath);
}

function normalizeWorkspacePathForProvider(provider: string, workspacePath: string): string {
    if (provider !== 'codex') {
        return workspacePath;
    }

    return normalizeCodexWorkspacePath(workspacePath);
}

export const sessionsDb = {

    createSession(
        session_id: string,
        provider: string,
        workspacePath: string,
        customName?: string,
        createdAt?: string,
        updatedAt?: string,
        jsonlPath?: string | null,
    ): void {
        const db = getConnection();
        const createdAtValue = normalizeTimestamp(createdAt);
        const updatedAtValue = normalizeTimestamp(updatedAt);
        const normalizedWorkspacePath = normalizeWorkspacePathForProvider(provider, workspacePath);

        // First, ensure the workspace path is recorded in the workspace_original_paths table
        // since it's a foreign key in the sessions table.
        workspaceOriginalPathsDb.createWorkspacePath(normalizedWorkspacePath);

        db.prepare(
            `INSERT INTO sessions (session_id, provider, custom_name, workspace_path, jsonl_path, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), COALESCE(?, CURRENT_TIMESTAMP))
             ON CONFLICT(session_id) DO UPDATE SET
               updated_at = excluded.updated_at,
               workspace_path = excluded.workspace_path,
               jsonl_path = excluded.jsonl_path
             WHERE sessions.provider = excluded.provider`
        ).run(
            session_id,
            provider,
            customName,
            normalizedWorkspacePath,
            jsonlPath ?? null,
            createdAtValue,
            updatedAtValue,
        );
    },

    /** Updates a custom session name by session id, regardless of provider. */
    updateSessionCustomName(sessionId: string, customName: string): void {
        const db = getConnection();
        db.prepare(
            `UPDATE sessions
             SET custom_name = ?
             WHERE session_id = ?`
        ).run(customName, sessionId);
    },

    /** Updates a custom session name for an existing session row. */
    createSessionName(sessionId: string, provider: string, customName: string): void {
        const db = getConnection();
        db.prepare(
            `UPDATE sessions
             SET custom_name = ?
             WHERE session_id = ? AND provider = ?`
        ).run(customName, sessionId, provider);
    },

    getSessionById(sessionId: string): SessionMetadataLookupRow | null {
        const db = getConnection();
        const row = db
            .prepare(
                `SELECT session_id, provider, workspace_path, jsonl_path, created_at, updated_at
                 FROM sessions
                 WHERE session_id = ?`
            )
            .get(sessionId) as SessionMetadataLookupRow | undefined;

        return row ?? null;
    },

    getAllSessions(): SessionsRow[] {
        const db = getConnection();
        return db
            .prepare(
                `SELECT session_id, provider, workspace_path, jsonl_path, custom_name, created_at, updated_at
                 FROM sessions`
            )
            .all() as SessionsRow[];
    },

    getSessionsByWorkspacePath(workspacePath: string): SessionsRow[] {
        const db = getConnection();
        return db
            .prepare(
                `SELECT session_id, provider, workspace_path, jsonl_path, custom_name, created_at, updated_at
                 FROM sessions
                 WHERE workspace_path = ?`
            )
            .all(workspacePath) as SessionsRow[];
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

