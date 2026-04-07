import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  deleteSessionById,
  deleteWorkspaceById,
  getWorkspaceSessions,
  updateSessionCustomName,
  updateWorkspaceCustomName,
  updateWorkspaceStar,
} from '@/components/refactored/sidebar/data/workspacesApi';
import type {
  SearchMode,
  SessionDeleteTarget,
  WorkspaceDeleteTarget,
  WorkspaceRecord,
  WorkspaceSession,
} from '@/components/refactored/sidebar/types';
import { filterWorkspacesBySearch } from '@/components/refactored/sidebar/utils/search';
import {
  getSessionDisplayName,
  getWorkspaceDisplayName,
  sortWorkspacesByLastActivity,
  splitWorkspacesByStarred,
} from '@/components/refactored/sidebar/utils/workspaceTransforms';

const SESSION_ROUTE_PATTERN = /^\/workspaces\/[^/]+\/sessions\/([^/]+)(?:\/[^/]+)?$/;

const extractSessionIdFromPathname = (pathname: string): string | null => {
  const sessionMatch = pathname.match(SESSION_ROUTE_PATTERN);
  if (sessionMatch?.[1]) {
    return decodeURIComponent(sessionMatch[1]);
  }

  return null;
};

/**
 * Hook layer (The Manager)
 * Owns sidebar workspace/session state and coordinates UI actions.
 */
export const useWorkspaces = () => {
  const navigate = useNavigate();
  const location = useLocation();

  const [workspaces, setWorkspaces] = useState<WorkspaceRecord[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [searchMode, setSearchMode] = useState<SearchMode>('projects');
  const [searchFilter, setSearchFilter] = useState('');
  const [expandedWorkspaces, setExpandedWorkspaces] = useState<Set<string>>(new Set());
  const [editingWorkspacePath, setEditingWorkspacePath] = useState<string | null>(null);
  const [editingWorkspaceName, setEditingWorkspaceName] = useState('');
  const [workspaceDeleteTarget, setWorkspaceDeleteTarget] = useState<WorkspaceDeleteTarget | null>(null);
  const [sessionDeleteTarget, setSessionDeleteTarget] = useState<SessionDeleteTarget | null>(null);
  const [isSavingWorkspaceName, setIsSavingWorkspaceName] = useState(false);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingSessionName, setEditingSessionName] = useState('');
  const [isSavingSessionName, setIsSavingSessionName] = useState(false);

  const selectedSessionId = useMemo(
    () => extractSessionIdFromPathname(location.pathname),
    [location.pathname],
  );

  const refreshWorkspaces = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const fetchedWorkspaces = await getWorkspaceSessions();
      setWorkspaces(sortWorkspacesByLastActivity(fetchedWorkspaces));
    } catch (error) {
      console.error('Failed to refresh workspaces:', error);
      setWorkspaces([]);
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refreshWorkspaces();
  }, [refreshWorkspaces]);

  const filteredWorkspaces = useMemo(
    () => filterWorkspacesBySearch(workspaces, searchMode, searchFilter),
    [searchFilter, searchMode, workspaces],
  );

  const workspaceGroups = useMemo(
    () => splitWorkspacesByStarred(filteredWorkspaces),
    [filteredWorkspaces],
  );

  const toggleWorkspace = useCallback((workspaceId: string, workspacePath: string) => {
    setExpandedWorkspaces((previousSet) => {
      const nextSet = new Set(previousSet);

      if (nextSet.has(workspacePath)) {
        nextSet.delete(workspacePath);
      } else {
        nextSet.add(workspacePath);
      }

      return nextSet;
    });
    navigate(`/workspaces/${encodeURIComponent(workspaceId)}`);
  }, [navigate]);

  const openSession = useCallback(
    (workspacePath: string, sessionId: string) => {
      setExpandedWorkspaces((previousSet) => {
        const nextSet = new Set(previousSet);
        nextSet.add(workspacePath);
        return nextSet;
      });

      const matchedWorkspace = workspaces.find(
        (workspace) => workspace.workspaceOriginalPath === workspacePath,
      );

      if (!matchedWorkspace) {
        return;
      }

      navigate(
        `/workspaces/${encodeURIComponent(matchedWorkspace.workspaceId)}/sessions/${encodeURIComponent(sessionId)}`,
      );
    },
    [navigate, workspaces],
  );

  const openNewSession = useCallback(() => {
    navigate('/');
  }, [navigate]);

  const toggleWorkspaceStar = useCallback(async (workspaceId: string) => {
    try {
      await updateWorkspaceStar(workspaceId);
      await refreshWorkspaces();
    } catch (error) {
      console.error('Failed to update workspace star:', error);
    }
  }, [refreshWorkspaces]);

  const startWorkspaceRename = useCallback((workspace: WorkspaceRecord) => {
    setEditingWorkspacePath(workspace.workspaceOriginalPath);
    setEditingWorkspaceName(workspace.workspaceCustomName || '');
  }, []);

  const cancelWorkspaceRename = useCallback(() => {
    setEditingWorkspacePath(null);
    setEditingWorkspaceName('');
  }, []);

  const saveWorkspaceRename = useCallback(async () => {
    if (!editingWorkspacePath) {
      return;
    }

    const editingWorkspace = workspaces.find(
      (workspace) => workspace.workspaceOriginalPath === editingWorkspacePath,
    );
    if (!editingWorkspace) {
      return;
    }

    setIsSavingWorkspaceName(true);
    try {
      const trimmedName = editingWorkspaceName.trim();
      await updateWorkspaceCustomName(editingWorkspace.workspaceId, trimmedName || null);
      await refreshWorkspaces();
      cancelWorkspaceRename();
    } catch (error) {
      console.error('Failed to update workspace name:', error);
    } finally {
      setIsSavingWorkspaceName(false);
    }
  }, [
    cancelWorkspaceRename,
    editingWorkspaceName,
    editingWorkspacePath,
    refreshWorkspaces,
    workspaces,
  ]);

  const requestWorkspaceDelete = useCallback((workspace: WorkspaceRecord) => {
    setWorkspaceDeleteTarget({
      workspaceId: workspace.workspaceId,
      workspacePath: workspace.workspaceOriginalPath,
      workspaceName: getWorkspaceDisplayName(workspace),
      sessionCount: workspace.sessions.length,
    });
  }, []);

  const cancelWorkspaceDelete = useCallback(() => {
    setWorkspaceDeleteTarget(null);
  }, []);

  const confirmWorkspaceDelete = useCallback(async () => {
    if (!workspaceDeleteTarget) {
      return;
    }

    const deletingWorkspaceId = workspaceDeleteTarget.workspaceId;
    const deletingWorkspacePath = workspaceDeleteTarget.workspacePath;
    setWorkspaceDeleteTarget(null);
    try {
      await deleteWorkspaceById(deletingWorkspaceId);

      // If the current session belonged to the deleted workspace, reset to root.
      const hadSelectedSession = workspaces.some(
        (workspace) =>
          workspace.workspaceOriginalPath === deletingWorkspacePath &&
          workspace.sessions.some((session) => session.sessionId === selectedSessionId),
      );
      if (hadSelectedSession) {
        navigate('/');
      }

      await refreshWorkspaces();
    } catch (error) {
      console.error('Failed to delete workspace:', error);
    }
  }, [
    navigate,
    refreshWorkspaces,
    selectedSessionId,
    workspaceDeleteTarget,
    workspaces,
  ]);

  const requestSessionDelete = useCallback(
    (workspacePath: string, session: WorkspaceSession) => {
      setSessionDeleteTarget({
        sessionId: session.sessionId,
        sessionName: getSessionDisplayName(session),
        workspacePath,
      });
    },
    [],
  );

  const cancelSessionDelete = useCallback(() => {
    setSessionDeleteTarget(null);
  }, []);

  const startSessionRename = useCallback((session: WorkspaceSession) => {
    setEditingSessionId(session.sessionId);
    setEditingSessionName(getSessionDisplayName(session));
  }, []);

  const cancelSessionRename = useCallback(() => {
    setEditingSessionId(null);
    setEditingSessionName('');
  }, []);

  const saveSessionRename = useCallback(async () => {
    if (!editingSessionId) {
      return;
    }

    const trimmedName = editingSessionName.trim();
    if (!trimmedName) {
      cancelSessionRename();
      return;
    }

    setIsSavingSessionName(true);
    try {
      await updateSessionCustomName(editingSessionId, trimmedName);
      await refreshWorkspaces();
      cancelSessionRename();
    } catch (error) {
      console.error('Failed to rename session:', error);
    } finally {
      setIsSavingSessionName(false);
    }
  }, [
    cancelSessionRename,
    editingSessionId,
    editingSessionName,
    refreshWorkspaces,
  ]);

  const confirmSessionDelete = useCallback(async () => {
    if (!sessionDeleteTarget) {
      return;
    }

    const deletingSessionId = sessionDeleteTarget.sessionId;
    setSessionDeleteTarget(null);

    try {
      await deleteSessionById(deletingSessionId);

      if (selectedSessionId === deletingSessionId) {
        navigate('/');
      }

      await refreshWorkspaces();
    } catch (error) {
      console.error('Failed to delete session:', error);
    }
  }, [navigate, refreshWorkspaces, selectedSessionId, sessionDeleteTarget]);

  return {
    workspaces,
    starredWorkspaces: workspaceGroups.starred,
    unstarredWorkspaces: workspaceGroups.unstarred,
    isRefreshing,
    refreshWorkspaces,
    searchMode,
    setSearchMode,
    searchFilter,
    setSearchFilter,
    selectedSessionId,
    expandedWorkspaces,
    toggleWorkspace,
    openSession,
    openNewSession,
    editingWorkspacePath,
    editingWorkspaceName,
    isSavingWorkspaceName,
    editingSessionId,
    editingSessionName,
    isSavingSessionName,
    setEditingWorkspaceName,
    setEditingSessionName,
    startWorkspaceRename,
    cancelWorkspaceRename,
    saveWorkspaceRename,
    startSessionRename,
    cancelSessionRename,
    saveSessionRename,
    toggleWorkspaceStar,
    workspaceDeleteTarget,
    sessionDeleteTarget,
    requestWorkspaceDelete,
    cancelWorkspaceDelete,
    confirmWorkspaceDelete,
    requestSessionDelete,
    cancelSessionDelete,
    confirmSessionDelete,
  };
};
