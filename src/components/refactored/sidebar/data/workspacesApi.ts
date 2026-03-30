import type { WorkspaceRecord } from '@/components/refactored/sidebar/types';
import { authenticatedFetch } from '@/utils/api';

const SIDEBAR_ENDPOINTS = {
  getWorkspaceSessions: '/api/sidebar/get-workspaces-sessions',
  updateWorkspaceStar: '/api/sidebar/update-workspace-star',
  updateWorkspaceCustomName: '/api/sidebar/update-workspace-custom-name',
  updateSessionCustomName: '/api/sidebar/update-session-custom-name',
  deleteWorkspace: '/api/sidebar/delete-workspace',
  deleteSession: '/api/sidebar/delete-session',
} as const;

const parseJsonSafely = async <T>(response: Response): Promise<T | null> => {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
};

const getErrorMessage = (fallbackMessage: string, payload: unknown): string => {
  if (
    payload &&
    typeof payload === 'object' &&
    'error' in payload &&
    typeof (payload as { error?: unknown }).error === 'string'
  ) {
    return (payload as { error: string }).error;
  }

  return fallbackMessage;
};

export const getWorkspaceSessions = async (): Promise<WorkspaceRecord[]> => {
  const response = await authenticatedFetch(SIDEBAR_ENDPOINTS.getWorkspaceSessions);
  const payload = await parseJsonSafely<{ workspaces?: WorkspaceRecord[]; error?: string }>(response);

  if (!response.ok) {
    throw new Error(getErrorMessage('Failed to fetch workspaces', payload));
  }

  return payload?.workspaces || [];
};

export const updateWorkspaceStar = async (
  workspacePath: string,
): Promise<{ workspacePath: string; isStarred: boolean }> => {
  const response = await authenticatedFetch(SIDEBAR_ENDPOINTS.updateWorkspaceStar, {
    method: 'PUT',
    body: JSON.stringify({ workspacePath }),
  });
  const payload = await parseJsonSafely<{
    workspacePath?: string;
    isStarred?: boolean;
    error?: string;
  }>(response);

  if (!response.ok) {
    throw new Error(getErrorMessage('Failed to update workspace star', payload));
  }

  return {
    workspacePath: payload?.workspacePath || workspacePath,
    isStarred: Boolean(payload?.isStarred),
  };
};

export const updateWorkspaceCustomName = async (
  workspacePath: string,
  workspaceCustomName: string | null,
): Promise<void> => {
  const response = await authenticatedFetch(SIDEBAR_ENDPOINTS.updateWorkspaceCustomName, {
    method: 'PUT',
    body: JSON.stringify({ workspacePath, workspaceCustomName }),
  });
  const payload = await parseJsonSafely<{ error?: string }>(response);

  if (!response.ok) {
    throw new Error(getErrorMessage('Failed to update workspace name', payload));
  }
};

export const deleteWorkspaceByPath = async (workspacePath: string): Promise<void> => {
  const response = await authenticatedFetch(SIDEBAR_ENDPOINTS.deleteWorkspace, {
    method: 'DELETE',
    body: JSON.stringify({ workspacePath }),
  });
  const payload = await parseJsonSafely<{ error?: string }>(response);

  if (!response.ok) {
    throw new Error(getErrorMessage('Failed to delete workspace', payload));
  }
};

export const updateSessionCustomName = async (
  sessionId: string,
  sessionCustomName: string,
): Promise<void> => {
  const response = await authenticatedFetch(SIDEBAR_ENDPOINTS.updateSessionCustomName, {
    method: 'PUT',
    body: JSON.stringify({ sessionId, sessionCustomName }),
  });
  const payload = await parseJsonSafely<{ error?: string }>(response);

  if (!response.ok) {
    throw new Error(getErrorMessage('Failed to update session name', payload));
  }
};

export const deleteSessionById = async (sessionId: string): Promise<void> => {
  const response = await authenticatedFetch(SIDEBAR_ENDPOINTS.deleteSession, {
    method: 'DELETE',
    body: JSON.stringify({ sessionId }),
  });
  const payload = await parseJsonSafely<{ error?: string }>(response);

  if (!response.ok) {
    throw new Error(getErrorMessage('Failed to delete session', payload));
  }
};
