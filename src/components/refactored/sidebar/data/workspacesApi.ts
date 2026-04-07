import type { WorkspaceRecord } from '@/components/refactored/sidebar/types';
import { authenticatedFetch } from '@/utils/api';

const SIDEBAR_ENDPOINTS = {
  getWorkspaceSessions: '/api/workspaces',
  updateWorkspaceStar: '/api/workspaces/star',
  updateWorkspaceCustomName: '/api/workspaces/name',
  deleteWorkspace: '/api/workspaces',
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

  if (
    payload &&
    typeof payload === 'object' &&
    'error' in payload &&
    typeof (payload as { error?: { message?: unknown } }).error?.message === 'string'
  ) {
    return (payload as { error: { message: string } }).error.message;
  }

  return fallbackMessage;
};

export const getWorkspaceSessions = async (): Promise<WorkspaceRecord[]> => {
  const response = await authenticatedFetch(SIDEBAR_ENDPOINTS.getWorkspaceSessions);
  const payload = await parseJsonSafely<{
    success?: boolean;
    data?: { workspaces?: WorkspaceRecord[] };
    error?: { message?: string };
  }>(response);

  if (!response.ok) {
    throw new Error(
      payload?.error?.message ||
        getErrorMessage('Failed to fetch workspaces', payload),
    );
  }

  return payload?.data?.workspaces || [];
};

export const updateWorkspaceStar = async (
  workspaceId: string,
): Promise<{ workspaceId: string; isStarred: boolean }> => {
  const response = await authenticatedFetch(SIDEBAR_ENDPOINTS.updateWorkspaceStar, {
    method: 'PATCH',
    body: JSON.stringify({ workspaceId }),
  });
  const payload = await parseJsonSafely<{
    success?: boolean;
    data?: {
      workspaceId?: string;
      isStarred?: boolean;
    };
    error?: { message?: string };
  }>(response);

  if (!response.ok) {
    throw new Error(
      payload?.error?.message ||
        getErrorMessage('Failed to update workspace star', payload),
    );
  }

  return {
    workspaceId: payload?.data?.workspaceId || workspaceId,
    isStarred: Boolean(payload?.data?.isStarred),
  };
};

export const updateWorkspaceCustomName = async (
  workspaceId: string,
  workspaceCustomName: string | null,
): Promise<void> => {
  const response = await authenticatedFetch(SIDEBAR_ENDPOINTS.updateWorkspaceCustomName, {
    method: 'PATCH',
    body: JSON.stringify({ workspaceId, workspaceCustomName }),
  });
  const payload = await parseJsonSafely<{ error?: { message?: string } }>(response);

  if (!response.ok) {
    throw new Error(
      payload?.error?.message ||
        getErrorMessage('Failed to update workspace name', payload),
    );
  }
};

export const deleteWorkspaceById = async (workspaceId: string): Promise<void> => {
  const response = await authenticatedFetch(SIDEBAR_ENDPOINTS.deleteWorkspace, {
    method: 'DELETE',
    body: JSON.stringify({ workspaceId }),
  });
  const payload = await parseJsonSafely<{ error?: { message?: string } }>(response);

  if (!response.ok) {
    throw new Error(
      payload?.error?.message ||
        getErrorMessage('Failed to delete workspace', payload),
    );
  }
};

export const updateSessionCustomName = async (
  sessionId: string,
  sessionCustomName: string,
): Promise<void> => {
  const response = await authenticatedFetch(`/api/llm/sessions/${encodeURIComponent(sessionId)}/rename`, {
    method: 'PUT',
    body: JSON.stringify({ summary: sessionCustomName }),
  });
  const payload = await parseJsonSafely<{ error?: { message?: string } }>(response);

  if (!response.ok) {
    throw new Error(
      payload?.error?.message ||
        getErrorMessage('Failed to update session name', payload),
    );
  }
};

export const deleteSessionById = async (sessionId: string): Promise<void> => {
  const response = await authenticatedFetch(`/api/llm/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'DELETE',
  });
  const payload = await parseJsonSafely<{ error?: { message?: string } }>(response);

  if (!response.ok) {
    throw new Error(
      payload?.error?.message ||
        getErrorMessage('Failed to delete session', payload),
    );
  }
};
