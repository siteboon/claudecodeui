import type {
  SearchMode,
  WorkspaceRecord,
} from '@/components/refactored/sidebar/types';

const includesSearch = (value: string | null | undefined, searchText: string): boolean =>
  (value || '').toLowerCase().includes(searchText);

/**
 * Filters workspaces and sessions based on search mode.
 * In conversations mode, sessions are filtered while preserving workspace context.
 */
export const filterWorkspacesBySearch = (
  workspaces: WorkspaceRecord[],
  searchMode: SearchMode,
  filterText: string,
): WorkspaceRecord[] => {
  const normalizedFilter = filterText.trim().toLowerCase();
  if (!normalizedFilter) {
    return workspaces;
  }

  if (searchMode === 'projects') {
    return workspaces.filter((workspace) =>
      includesSearch(workspace.workspaceDisplayName, normalizedFilter) ||
      includesSearch(workspace.workspaceCustomName, normalizedFilter) ||
      includesSearch(workspace.workspaceOriginalPath, normalizedFilter),
    );
  }

  return workspaces
    .map((workspace) => {
      const workspaceMatches =
        includesSearch(workspace.workspaceDisplayName, normalizedFilter) ||
        includesSearch(workspace.workspaceCustomName, normalizedFilter) ||
        includesSearch(workspace.workspaceOriginalPath, normalizedFilter);

      if (workspaceMatches) {
        return workspace;
      }

      const matchingSessions = workspace.sessions.filter((session) =>
        includesSearch(session.customName, normalizedFilter) ||
        includesSearch(session.summary, normalizedFilter) ||
        includesSearch(session.sessionId, normalizedFilter) ||
        includesSearch(session.provider, normalizedFilter),
      );

      if (matchingSessions.length === 0) {
        return null;
      }

      return {
        ...workspace,
        sessions: matchingSessions,
      };
    })
    .filter((workspace): workspace is WorkspaceRecord => Boolean(workspace));
};
