import { getConnection } from '@/modules/database/connection.js';
import { projectsDb } from '@/modules/database/repositories/projects.db.js';
import { normalizeProjectPath } from '@/shared/utils.js';

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

function normalizeTimestamp(value?: string): string | null {
  if (!value) return null;

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString();
}

function normalizeProjectPathForProvider(provider: string, projectPath: string): string {
  void provider;
  return normalizeProjectPath(projectPath);
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
  ): string {
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
       ON CONFLICT(session_id) DO UPDATE SET
         provider = excluded.provider,
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

    return sessionId;
  },

  updateSessionCustomName(sessionId: string, customName: string): void {
    const db = getConnection();
    db.prepare(
      `UPDATE sessions
       SET custom_name = ?
       WHERE session_id = ?`
    ).run(customName, sessionId);
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
    const normalizedProjectPath = normalizeProjectPath(projectPath);
    return db
      .prepare(
        `SELECT session_id, provider, project_path, jsonl_path, custom_name, created_at, updated_at
         FROM sessions
         WHERE project_path = ?`
      )
      .all(normalizedProjectPath) as SessionRow[];
  },

  getSessionsByProjectPathPage(projectPath: string, limit: number, offset: number): SessionRow[] {
    const db = getConnection();
    const normalizedProjectPath = normalizeProjectPath(projectPath);
    return db
      .prepare(
        `SELECT session_id, provider, project_path, jsonl_path, custom_name, created_at, updated_at
         FROM sessions
         WHERE project_path = ?
         ORDER BY datetime(COALESCE(updated_at, created_at)) DESC, session_id DESC
         LIMIT ? OFFSET ?`
      )
      .all(normalizedProjectPath, limit, offset) as SessionRow[];
  },

  countSessionsByProjectPath(projectPath: string): number {
    const db = getConnection();
    const normalizedProjectPath = normalizeProjectPath(projectPath);
    const row = db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM sessions
         WHERE project_path = ?`
      )
      .get(normalizedProjectPath) as { count: number } | undefined;

    return Number(row?.count ?? 0);
  },

  deleteSessionsByProjectPath(projectPath: string): void {
    const db = getConnection();
    const normalizedProjectPath = normalizeProjectPath(projectPath);
    db.prepare(`DELETE FROM sessions WHERE project_path = ?`).run(normalizedProjectPath);
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

  deleteSessionById(sessionId: string): boolean {
    const db = getConnection();
    return db.prepare('DELETE FROM sessions WHERE session_id = ?').run(sessionId).changes > 0;
  },
};
