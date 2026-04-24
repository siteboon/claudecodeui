import path from 'node:path';

import { getConnection } from '@/modules/database/connection.js';
import { projectsDb } from '@/modules/database/repositories/projects.db.js';

type SessionNameLookupRow = {
  session_id: string;
  custom_name: string;
};

type SessionRow = {
  session_id: string;
  provider: string;
  project_path: string | null;
  jsonl_path: string | null;
  custom_name: string | null;
  created_at: string;
  updated_at: string;
};

type SessionMetadataLookupRow = Pick<
  SessionRow,
  'session_id' | 'provider' | 'project_path' | 'jsonl_path' | 'custom_name' | 'created_at' | 'updated_at'
>;

type LegacySessionSummary = {
  id: string;
  summary?: string;
};

function normalizeTimestamp(value?: string): string | null {
  if (!value) return null;

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString();
}

function normalizeCodexProjectPath(projectPath: string): string {
  const trimmedPath = projectPath.trim();
  if (!trimmedPath) {
    return projectPath;
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

function normalizeProjectPathForProvider(provider: string, projectPath: string): string {
  if (provider !== 'codex') {
    return projectPath;
  }

  return normalizeCodexProjectPath(projectPath);
}

export const sessionsDb = {
  createSession(
    sessionId: string,
    provider: string,
    projectPath: string,
    customName?: string,
    createdAt?: string,
    updatedAt?: string,
    jsonlPath?: string | null
  ): void {
    const db = getConnection();
    const createdAtValue = normalizeTimestamp(createdAt);
    const updatedAtValue = normalizeTimestamp(updatedAt);
    const normalizedProjectPath = normalizeProjectPathForProvider(provider, projectPath);

    // First, ensure the project path is recorded in the projects table,
    // since it's a foreign key in the sessions table.
    projectsDb.createProjectPath(normalizedProjectPath);

    db.prepare(
      `INSERT INTO sessions (session_id, provider, custom_name, project_path, jsonl_path, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), COALESCE(?, CURRENT_TIMESTAMP))
       ON CONFLICT(session_id, provider) DO UPDATE SET
         updated_at = excluded.updated_at,
         project_path = excluded.project_path,
         jsonl_path = excluded.jsonl_path,
         custom_name = COALESCE(excluded.custom_name, sessions.custom_name)`
    ).run(
      sessionId,
      provider,
      customName ?? null,
      normalizedProjectPath,
      jsonlPath ?? null,
      createdAtValue,
      updatedAtValue
    );
  },

  updateSessionCustomName(sessionId: string, customName: string): void {
    const db = getConnection();
    db.prepare(
      `UPDATE sessions
       SET custom_name = ?
       WHERE session_id = ?`
    ).run(customName, sessionId);
  },

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
        `SELECT session_id, provider, project_path, jsonl_path, custom_name, created_at, updated_at
         FROM sessions
         WHERE session_id = ?
         ORDER BY updated_at DESC
         LIMIT 1`
      )
      .get(sessionId) as SessionMetadataLookupRow | undefined;

    return row ?? null;
  },

  getAllSessions(): SessionRow[] {
    const db = getConnection();
    return db
      .prepare(
        `SELECT session_id, provider, project_path, jsonl_path, custom_name, created_at, updated_at
         FROM sessions`
      )
      .all() as SessionRow[];
  },

  getSessionsByProjectPath(projectPath: string): SessionRow[] {
    const db = getConnection();
    return db
      .prepare(
        `SELECT session_id, provider, project_path, jsonl_path, custom_name, created_at, updated_at
         FROM sessions
         WHERE project_path = ?`
      )
      .all(projectPath) as SessionRow[];
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

  /**
   * Legacy-compatibility method kept for parity with `server/database/db.js`.
   * TODO: Remove after all legacy imports are migrated to the new repository API.
   */
  setName(sessionId: string, provider: string, customName: string): void {
    const db = getConnection();
    db.prepare(
      `INSERT INTO sessions (session_id, provider, custom_name)
       VALUES (?, ?, ?)
       ON CONFLICT(session_id, provider) DO UPDATE SET
         custom_name = excluded.custom_name,
         updated_at = CURRENT_TIMESTAMP`
    ).run(sessionId, provider, customName);
  },

  /**
   * Legacy-compatibility method kept for parity with `server/database/db.js`.
   * TODO: Remove after all legacy imports are migrated to the new repository API.
   */
  getName(sessionId: string, provider: string): string | null {
    return sessionsDb.getSessionName(sessionId, provider);
  },

  /**
   * Legacy-compatibility method kept for parity with `server/database/db.js`.
   * TODO: Remove after all legacy imports are migrated to the new repository API.
   */
  getNames(sessionIds: string[], provider: string): Map<string, string> {
    return sessionsDb.getSessionNames(sessionIds, provider);
  },

  /**
   * Legacy-compatibility method kept for parity with `server/database/db.js`.
   * TODO: Remove after all legacy imports are migrated to the new repository API.
   */
  deleteName(sessionId: string, provider: string): boolean {
    const db = getConnection();
    return (
      db
        .prepare(
          `DELETE FROM sessions
           WHERE session_id = ? AND provider = ?`
        )
        .run(sessionId, provider).changes > 0
    );
  },

  deleteSession(sessionId: string): void {
    const db = getConnection();
    db.prepare('DELETE FROM sessions WHERE session_id = ?').run(sessionId);
  },
};

/**
 * Legacy-compatibility helper kept for parity with `server/database/db.js`.
 * TODO: Remove after all legacy imports are migrated to the new repository API.
 */
export function applyCustomSessionNames(
  sessions: LegacySessionSummary[] | null | undefined,
  provider: string
): void {
  if (!sessions?.length) return;

  try {
    const sessionIds = sessions.map((session) => session.id);
    const customNames = sessionsDb.getNames(sessionIds, provider);

    for (const session of sessions) {
      const customName = customNames.get(session.id);
      if (customName) {
        session.summary = customName;
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[DB] Failed to apply custom session names for ${provider}:`, message);
  }
}
