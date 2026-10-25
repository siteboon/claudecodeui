import { randomUUID } from 'node:crypto';

import { getConnection } from '@/modules/database/index.js';

export type WorkbenchAgent = 'claude' | 'codex';
export type WorkbenchStatus = 'running' | 'waiting' | 'done' | 'error' | 'discarded';

export type WorkbenchSession = {
  id: string;
  projectPath: string;
  projectId: string | null;
  worktreePath: string;
  branch: string;
  baseBranch: string;
  agent: WorkbenchAgent;
  profileId: string;
  title: string;
  status: WorkbenchStatus;
  createdAt: string;
  lastActivityAt: string;
  cliSessionId: string | null;
  firstPrompt: string;
  launched: boolean;
};

type Row = {
  id: string;
  project_path: string;
  project_id: string | null;
  worktree_path: string;
  branch: string;
  base_branch: string;
  agent: string;
  profile_id: string;
  title: string;
  status: string;
  created_at: string;
  last_activity_at: string;
  cli_session_id: string | null;
  first_prompt: string;
  launched: number;
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS workbench_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  project_path TEXT NOT NULL,
  project_id TEXT,
  worktree_path TEXT NOT NULL,
  branch TEXT NOT NULL,
  base_branch TEXT NOT NULL,
  agent TEXT NOT NULL,
  profile_id TEXT NOT NULL DEFAULT 'none',
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  created_at TEXT NOT NULL,
  last_activity_at TEXT NOT NULL,
  cli_session_id TEXT,
  first_prompt TEXT NOT NULL DEFAULT '',
  launched INTEGER NOT NULL DEFAULT 0
);
`;

let schemaReady = false;

function db() {
  const connection = getConnection();
  if (!schemaReady) {
    connection.exec(SCHEMA);
    schemaReady = true;
  }
  return connection;
}

/** Test hook: the schema flag belongs to one connection. */
export function resetWorkbenchStoreForTests(): void {
  schemaReady = false;
}

function toSession(row: Row): WorkbenchSession {
  return {
    id: row.id,
    projectPath: row.project_path,
    projectId: row.project_id,
    worktreePath: row.worktree_path,
    branch: row.branch,
    baseBranch: row.base_branch,
    agent: row.agent === 'codex' ? 'codex' : 'claude',
    profileId: row.profile_id,
    title: row.title,
    status: row.status as WorkbenchStatus,
    createdAt: row.created_at,
    lastActivityAt: row.last_activity_at,
    cliSessionId: row.cli_session_id,
    firstPrompt: row.first_prompt,
    launched: row.launched === 1,
  };
}

export const workbenchSessionsStore = {
  insert(input: Omit<WorkbenchSession, 'id' | 'createdAt' | 'lastActivityAt' | 'status' | 'cliSessionId' | 'launched'>): WorkbenchSession {
    const now = new Date().toISOString();
    const id = randomUUID();
    db()
      .prepare(
        `INSERT INTO workbench_sessions
          (id, project_path, project_id, worktree_path, branch, base_branch, agent, profile_id, title, status, created_at, last_activity_at, first_prompt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', ?, ?, ?)`,
      )
      .run(
        id,
        input.projectPath,
        input.projectId,
        input.worktreePath,
        input.branch,
        input.baseBranch,
        input.agent,
        input.profileId,
        input.title,
        now,
        now,
        input.firstPrompt,
      );
    return this.get(id) as WorkbenchSession;
  },

  get(id: string): WorkbenchSession | null {
    const row = db().prepare('SELECT * FROM workbench_sessions WHERE id = ?').get(id) as Row | undefined;
    return row ? toSession(row) : null;
  },

  list(): WorkbenchSession[] {
    const rows = db()
      .prepare("SELECT * FROM workbench_sessions WHERE status != 'discarded' ORDER BY last_activity_at DESC")
      .all() as Row[];
    return rows.map(toSession);
  },

  listBranches(projectPath: string): string[] {
    const rows = db()
      .prepare('SELECT branch FROM workbench_sessions WHERE project_path = ?')
      .all(projectPath) as Array<{ branch: string }>;
    return rows.map((row) => row.branch);
  },

  setStatus(id: string, status: WorkbenchStatus): void {
    db()
      .prepare('UPDATE workbench_sessions SET status = ?, last_activity_at = ? WHERE id = ?')
      .run(status, new Date().toISOString(), id);
  },

  touch(id: string): void {
    db().prepare('UPDATE workbench_sessions SET last_activity_at = ? WHERE id = ?').run(new Date().toISOString(), id);
  },

  markLaunched(id: string): void {
    db().prepare('UPDATE workbench_sessions SET launched = 1 WHERE id = ?').run(id);
  },

  setCliSessionId(id: string, cliSessionId: string): void {
    db().prepare('UPDATE workbench_sessions SET cli_session_id = ? WHERE id = ?').run(cliSessionId, id);
  },

  rename(id: string, title: string): void {
    db().prepare('UPDATE workbench_sessions SET title = ? WHERE id = ?').run(title, id);
  },

  markDiscarded(id: string): void {
    db().prepare("UPDATE workbench_sessions SET status = 'discarded' WHERE id = ?").run(id);
  },
};
