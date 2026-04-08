// TODO: Remove this legacy response adapter once all consumers are migrated to the workspaces API shape.

import type { Project, ProjectSession, SessionProvider } from '@/types/app';
import { getWorkspaceSessions } from '@/components/refactored/sidebar/data/workspacesApi';
import type { WorkspaceRecord, WorkspaceSession } from '@/components/refactored/sidebar/types';

const readString = (value: unknown): string | null =>
  typeof value === 'string' ? value : null;

const readNumber = (value: unknown): number | null =>
  typeof value === 'number' ? value : null;

const toLegacySession = (
  session: WorkspaceSession,
  projectName: string | null,
): ProjectSession => {
  const id = readString(session.id) ?? readString(session.sessionId);
  const summary = readString(session.summary);
  const name = readString(session.customName) ?? summary;

  return {
    id,
    title: name,
    summary,
    name,
    createdAt: readString(session.createdAt),
    created_at: readString(session.createdAt),
    updated_at: readString(session.updatedAt),
    lastActivity: readString(session.lastActivity),
    messageCount: readNumber((session as Record<string, unknown>).messageCount),
    __provider: (readString(session.provider) as SessionProvider | null) ?? null,
    __projectName: projectName,
  } as unknown as ProjectSession;
};

const mapWorkspaceToLegacyProject = (workspace: WorkspaceRecord): Project => {
  const projectName =
    readString(workspace.workspaceOriginalPath) ??
    readString(workspace.workspaceDisplayName);
  const legacySessions = workspace.sessions.map((session) =>
    toLegacySession(session, projectName),
  );

  const claudeSessions = legacySessions.filter(
    (session) => session.__provider === 'claude',
  );
  const cursorSessions = legacySessions.filter(
    (session) => session.__provider === 'cursor',
  );
  const codexSessions = legacySessions.filter(
    (session) => session.__provider === 'codex',
  );
  const geminiSessions = legacySessions.filter(
    (session) => session.__provider === 'gemini',
  );

  return {
    name: projectName,
    displayName:
      readString(workspace.workspaceCustomName) ??
      readString(workspace.workspaceDisplayName),
    fullPath: readString(workspace.workspaceOriginalPath),
    path: readString(workspace.workspaceOriginalPath),
    sessions: claudeSessions.length > 0 ? claudeSessions : null,
    cursorSessions: cursorSessions.length > 0 ? cursorSessions : null,
    codexSessions: codexSessions.length > 0 ? codexSessions : null,
    geminiSessions: geminiSessions.length > 0 ? geminiSessions : null,
    sessionMeta: null,
    taskmaster: null,
  } as unknown as Project;
};

export const getProjectsInLegacyFormat = async (
  workspaceId: string,
): Promise<Project | null> => {
  const workspaces = await getWorkspaceSessions();
  const workspace = workspaces.find(
    (workspaceRecord) => workspaceRecord.workspaceId === workspaceId,
  );

  if (!workspace) {
    return null;
  }

  return mapWorkspaceToLegacyProject(workspace);
};

export const getSessionInLegacyFormat = async (
  sessionId: string,
): Promise<{ project: Project; session: ProjectSession } | null> => {
  const workspaces = await getWorkspaceSessions();

  for (const workspace of workspaces) {
    const legacyProject = mapWorkspaceToLegacyProject(workspace);
    const projectName =
      readString(workspace.workspaceOriginalPath) ??
      readString(workspace.workspaceDisplayName);
    const matchedSession = workspace.sessions.find(
      (session) => session.sessionId === sessionId || session.id === sessionId,
    );

    if (matchedSession) {
      return {
        project: legacyProject,
        session: toLegacySession(matchedSession, projectName),
      };
    }
  }

  return null;
};
