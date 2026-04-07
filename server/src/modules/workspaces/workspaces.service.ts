import path from 'node:path';

import { llmSessionsService } from '@/modules/ai-runtime/services/sessions.service.js';
import { sessionsDb } from '@/shared/database/repositories/sessions.db.js';
import { workspaceOriginalPathsDb } from '@/shared/database/repositories/workspace-original-paths.db.js';
import type { SessionsRow } from '@/shared/database/types.js';
import { AppError } from '@/shared/utils/app-error.js';

export type WorkspaceSessionRecord = {
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

export type WorkspaceRecord = {
  workspaceId: string;
  workspaceOriginalPath: string;
  workspaceCustomName: string | null;
  workspaceDisplayName: string;
  isStarred: boolean;
  lastActivity: string | null;
  sessions: WorkspaceSessionRecord[];
};

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

const toWorkspaceSessionRecord = (session: SessionsRow): WorkspaceSessionRecord => {
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

const sortSessionsByLastActivity = (sessions: WorkspaceSessionRecord[]): WorkspaceSessionRecord[] =>
  [...sessions].sort((left, right) => {
    const timestampDifference =
      parseTimestamp(right.lastActivity) - parseTimestamp(left.lastActivity);

    if (timestampDifference !== 0) {
      return timestampDifference;
    }

    return right.sessionId.localeCompare(left.sessionId);
  });

const sortWorkspacesByLastActivity = (
  workspaces: WorkspaceRecord[],
): WorkspaceRecord[] =>
  [...workspaces].sort((left, right) => {
    const timestampDifference =
      parseTimestamp(right.lastActivity) - parseTimestamp(left.lastActivity);

    if (timestampDifference !== 0) {
      return timestampDifference;
    }

    return left.workspaceDisplayName.localeCompare(right.workspaceDisplayName);
  });

/**
 * Groups indexed sessions by workspace and returns a deterministic catalog shape.
 */
const buildWorkspaceSessionCollection = (): WorkspaceRecord[] => {
  const workspaceRows = workspaceOriginalPathsDb.getWorkspacePaths();
  const sessionRows = sessionsDb.getAllSessions();
  const sessionsByWorkspace = new Map<string, WorkspaceSessionRecord[]>();

  // Build grouped sessions once to keep the response shape deterministic.
  for (const sessionRow of sessionRows) {
    const existing = sessionsByWorkspace.get(sessionRow.workspace_path) || [];
    existing.push(toWorkspaceSessionRecord(sessionRow));
    sessionsByWorkspace.set(sessionRow.workspace_path, existing);
  }

  const workspaceRecords = workspaceRows.map((workspaceRow) => {
    const sessions = sortSessionsByLastActivity(
      sessionsByWorkspace.get(workspaceRow.workspace_path) || [],
    );
    const lastActivity = sessions[0]?.lastActivity || null;

    return {
      workspaceId: workspaceRow.workspace_id,
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

/**
 * Workspace catalog facade consumed by HTTP routes.
 */
export const workspaceService = {
  listWorkspaces(): WorkspaceRecord[] {
    return buildWorkspaceSessionCollection();
  },

  toggleWorkspaceStar(workspaceId: string): boolean {
    const workspaceRow = workspaceOriginalPathsDb.getWorkspaceById(workspaceId);
    if (!workspaceRow) {
      throw new AppError('Workspace not found.', {
        code: 'WORKSPACE_NOT_FOUND',
        statusCode: 404,
      });
    }

    const nextIsStarred = workspaceRow.isStarred !== 1;
    workspaceOriginalPathsDb.updateWorkspaceIsStarredById(workspaceId, nextIsStarred);

    return nextIsStarred;
  },

  updateWorkspaceCustomName(workspaceId: string, workspaceCustomName: string | null): void {
    const workspaceRow = workspaceOriginalPathsDb.getWorkspaceById(workspaceId);
    if (!workspaceRow) {
      throw new AppError('Workspace not found.', {
        code: 'WORKSPACE_NOT_FOUND',
        statusCode: 404,
      });
    }

    workspaceOriginalPathsDb.updateCustomWorkspaceNameById(workspaceId, workspaceCustomName);
  },

  async deleteWorkspace(workspaceId: string): Promise<{
    workspaceId: string;
    workspacePath: string;
    deletedWorkspace: boolean;
    deletedSessionCount: number;
    jsonlDeletedCount: number;
    failedSessionFileDeletes: string[];
  }> {
    const workspaceRow = workspaceOriginalPathsDb.getWorkspaceById(workspaceId);
    if (!workspaceRow) {
      throw new AppError('Workspace not found.', {
        code: 'WORKSPACE_NOT_FOUND',
        statusCode: 404,
      });
    }

    const workspacePath = workspaceRow.workspace_path;
    const sessionRows = sessionsDb.getSessionsByWorkspacePath(workspacePath);
    const failedSessionFileDeletes: string[] = [];
    let jsonlDeletedCount = 0;

    // Remove all session files first, then clean up DB rows.
    for (const sessionRow of sessionRows) {
      try {
        const deletionResult = await llmSessionsService.deleteSessionArtifacts(
          sessionRow.session_id,
        );

        if (deletionResult.deletedFromDisk) {
          jsonlDeletedCount += 1;
        }
      } catch {
        failedSessionFileDeletes.push(sessionRow.session_id);
      }
    }

    workspaceOriginalPathsDb.deleteWorkspaceById(workspaceId);

    return {
      workspaceId,
      workspacePath,
      deletedWorkspace: true,
      deletedSessionCount: sessionRows.length,
      jsonlDeletedCount,
      failedSessionFileDeletes,
    };
  },
};
