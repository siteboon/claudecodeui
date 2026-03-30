import path from 'node:path';

import { deleteClaudeSession } from '@/modules/providers/claude/claude.session-processor.js';
import { deleteCodexSession } from '@/modules/providers/codex/codex.session-processor.js';
import { deleteCursorSession } from '@/modules/providers/cursor/cursor.session-processor.js';
import { deleteGeminiSession } from '@/modules/providers/gemini/gemini.session-processor.js';
import { sessionsDb } from '@/shared/database/repositories/sessions.db.js';
import { workspaceOriginalPathsDb } from '@/shared/database/repositories/workspace-original-paths.db.js';
import type { SessionsRow } from '@/shared/database/types.js';

export type SidebarSessionRecord = {
  sessionId: string;
  id: string;
  provider: SessionsRow['provider'];
  customName: string | null;
  summary: string;
  workspacePath: string;
  createdAt: string | null;
  updatedAt: string | null;
  lastActivity: string | null;
};

export type SidebarWorkspaceRecord = {
  workspaceOriginalPath: string;
  workspaceCustomName: string | null;
  workspaceDisplayName: string;
  isStarred: boolean;
  lastActivity: string | null;
  sessions: SidebarSessionRecord[];
};

export type DeleteSessionResult = {
  deleted: boolean;
  jsonlDeleted: boolean;
};

export type DeleteWorkspaceResult = {
  deletedWorkspace: boolean;
  deletedSessionCount: number;
  jsonlDeletedCount: number;
  failedSessionFileDeletes: string[];
};

type SessionDeletionTarget = Pick<SessionsRow, 'session_id' | 'provider' | 'workspace_path' | 'created_at'>;

const parseTimestamp = (timestamp: string | null | undefined): number => {
  if (!timestamp) {
    return 0;
  }

  // SQLite CURRENT_TIMESTAMP is UTC but stored without timezone ("YYYY-MM-DD HH:MM:SS").
  // Normalize this format so parsing is always timezone-correct.
  const sqliteUtcPattern = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
  const normalizedTimestamp = sqliteUtcPattern.test(timestamp)
    ? `${timestamp.replace(' ', 'T')}Z`
    : timestamp;

  const parsed = new Date(normalizedTimestamp).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
};

const toSidebarSessionRecord = (session: SessionsRow): SidebarSessionRecord => {
  const lastActivity = session.updated_at || session.created_at || null;

  return {
    sessionId: session.session_id,
    id: session.session_id,
    provider: session.provider,
    customName: session.custom_name,
    summary: session.custom_name || 'Untitled Session',
    workspacePath: session.workspace_path,
    createdAt: session.created_at || null,
    updatedAt: session.updated_at || null,
    lastActivity,
  };
};

const sortSessionsByLastActivity = (sessions: SidebarSessionRecord[]): SidebarSessionRecord[] =>
  [...sessions].sort((left, right) => {
    const timestampDifference =
      parseTimestamp(right.lastActivity) - parseTimestamp(left.lastActivity);

    if (timestampDifference !== 0) {
      return timestampDifference;
    }

    return right.sessionId.localeCompare(left.sessionId);
  });

const sortWorkspacesByLastActivity = (
  workspaces: SidebarWorkspaceRecord[],
): SidebarWorkspaceRecord[] =>
  [...workspaces].sort((left, right) => {
    const timestampDifference =
      parseTimestamp(right.lastActivity) - parseTimestamp(left.lastActivity);

    if (timestampDifference !== 0) {
      return timestampDifference;
    }

    return left.workspaceDisplayName.localeCompare(right.workspaceDisplayName);
  });

const deleteSessionFileByProvider = async (
  session: SessionDeletionTarget,
): Promise<boolean> => {
  switch (session.provider) {
    case 'claude':
      return deleteClaudeSession(session.session_id, session.workspace_path);
    case 'codex':
      return deleteCodexSession(session.session_id, session.created_at);
    case 'cursor':
      return deleteCursorSession(session.session_id, session.workspace_path);
    case 'gemini':
      return deleteGeminiSession(session.session_id);
    default:
      return false;
  }
};

export const getWorkspaceSessionsCollection = (): SidebarWorkspaceRecord[] => {
  const workspaceRows = workspaceOriginalPathsDb.getWorkspacePaths();
  const sessionRows = sessionsDb.getAllSessions();
  const sessionsByWorkspace = new Map<string, SidebarSessionRecord[]>();

  // Build grouped sessions once to keep the response shape deterministic.
  for (const sessionRow of sessionRows) {
    const existing = sessionsByWorkspace.get(sessionRow.workspace_path) || [];
    existing.push(toSidebarSessionRecord(sessionRow));
    sessionsByWorkspace.set(sessionRow.workspace_path, existing);
  }

  const workspaceRecords = workspaceRows.map((workspaceRow) => {
    const sessions = sortSessionsByLastActivity(
      sessionsByWorkspace.get(workspaceRow.workspace_path) || [],
    );
    const lastActivity = sessions[0]?.lastActivity || null;

    return {
      workspaceOriginalPath: workspaceRow.workspace_path,
      workspaceCustomName: workspaceRow.custom_workspace_name,
      workspaceDisplayName:
        workspaceRow.custom_workspace_name ||
        path.basename(workspaceRow.workspace_path) ||
        workspaceRow.workspace_path,
      isStarred: workspaceRow.isStarred === 1,
      lastActivity,
      sessions,
    };
  });

  return sortWorkspacesByLastActivity(workspaceRecords);
};

export const updateWorkspaceStarByPath = (workspacePath: string): boolean => {
  const workspaceRow = workspaceOriginalPathsDb.getWorkspacePath(workspacePath);
  if (!workspaceRow) {
    throw new Error('Workspace not found');
  }

  const nextIsStarred = workspaceRow.isStarred !== 1;
  workspaceOriginalPathsDb.updateWorkspaceIsStarred(workspacePath, nextIsStarred);

  return nextIsStarred;
};

export const updateWorkspaceNameByPath = (
  workspacePath: string,
  workspaceCustomName: string | null,
): void => {
  workspaceOriginalPathsDb.updateCustomWorkspaceName(workspacePath, workspaceCustomName);
};

export const updateSessionNameById = (
  sessionId: string,
  sessionCustomName: string,
): void => {
  const sessionMetadata = sessionsDb.getSessionById(sessionId);
  if (!sessionMetadata) {
    throw new Error('Session not found');
  }

  sessionsDb.updateSessionCustomName(sessionId, sessionCustomName);
};

export const deleteSessionById = async (
  sessionId: string,
): Promise<DeleteSessionResult> => {
  const sessionMetadata = sessionsDb.getSessionById(sessionId);
  if (!sessionMetadata) {
    return {
      deleted: false,
      jsonlDeleted: false,
    };
  }

  const jsonlDeleted = await deleteSessionFileByProvider({
    session_id: sessionMetadata.session_id,
    provider: sessionMetadata.provider,
    workspace_path: sessionMetadata.workspace_path,
    created_at: sessionMetadata.created_at,
  });

  sessionsDb.deleteSession(sessionId);

  return {
    deleted: true,
    jsonlDeleted,
  };
};

export const deleteWorkspaceByPath = async (
  workspacePath: string,
): Promise<DeleteWorkspaceResult> => {
  const sessionRows = sessionsDb.getSessionsByWorkspacePath(workspacePath);
  const failedSessionFileDeletes: string[] = [];
  let jsonlDeletedCount = 0;

  // Remove all session files first, then clean up DB rows.
  for (const sessionRow of sessionRows) {
    try {
      const deleted = await deleteSessionFileByProvider({
        session_id: sessionRow.session_id,
        provider: sessionRow.provider,
        workspace_path: sessionRow.workspace_path,
        created_at: sessionRow.created_at,
      });

      if (deleted) {
        jsonlDeletedCount += 1;
      }
    } catch {
      failedSessionFileDeletes.push(sessionRow.session_id);
    } finally {
      sessionsDb.deleteSession(sessionRow.session_id);
    }
  }

  workspaceOriginalPathsDb.deleteWorkspacePath(workspacePath);

  return {
    deletedWorkspace: true,
    deletedSessionCount: sessionRows.length,
    jsonlDeletedCount,
    failedSessionFileDeletes,
  };
};
