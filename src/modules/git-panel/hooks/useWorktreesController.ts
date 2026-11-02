import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '@/shared/api';
import type { MergeWorktreeOptions, Project, RemoveWorktreeOptions, WorktreeInfo } from '@/shared/types';

// ---------------------------------------------------------------------------
// Worktrees — mirrors the /api/worktrees payloads (server/shared/types.ts)
// ---------------------------------------------------------------------------

type WorktreeListData = {
  repositoryRoot: string;
  /** Branch checked out in the main worktree — the merge target. */
  baseBranch: string | null;
  worktrees: WorktreeInfo[];
};

/** `/api/worktrees` uses the shared `{ success, data | error }` envelope. */
type WorktreeApiEnvelope<TData> = {
  success?: boolean;
  data?: TData;
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
};

type UseWorktreesControllerOptions = {
  selectedProject: Project | null;
  onProjectSelect?: (project: Project) => void;
  onProjectsRefresh?: () => void;
};

type WorktreeProjectPayload = {
  project?: Project;
};

function readEnvelopeError<TData>(payload: WorktreeApiEnvelope<TData>, fallback: string): string {
  const message = payload.error?.message || fallback;
  const details = payload.error?.details;

  if (Array.isArray(details) && details.length > 0) {
    return `${message}: ${details.slice(0, 5).join(', ')}${details.length > 5 ? ', …' : ''}`;
  }

  if (typeof details === 'string' && details.trim()) {
    return `${message}: ${details.trim()}`;
  }

  return message;
}

export function useWorktreesController({
  selectedProject,
  onProjectSelect,
  onProjectsRefresh,
}: UseWorktreesControllerOptions) {
  const [worktreeData, setWorktreeData] = useState<WorktreeListData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [isCreatingWorktree, setIsCreatingWorktree] = useState(false);
  /** Path of the worktree with an open/merge/remove request in flight (one at a time). */
  const [busyWorktreePath, setBusyWorktreePath] = useState<string | null>(null);
  const activeWorktreeOperationRef = useRef<symbol | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const clearActionError = useCallback(() => setActionError(null), []);

  // Detects stale responses after the user switches projects mid-request.
  const selectedProjectIdRef = useRef<string | null>(selectedProject?.projectId ?? null);
  useEffect(() => {
    selectedProjectIdRef.current = selectedProject?.projectId ?? null;
  }, [selectedProject]);

  const fetchWorktrees = useCallback(async () => {
    if (!selectedProject) {
      return;
    }

    const projectId = selectedProject.projectId;
    setIsLoading(true);
    try {
      const response = await api.worktrees.list(projectId);
      const payload = (await response.json()) as WorktreeApiEnvelope<WorktreeListData>;

      if (selectedProjectIdRef.current !== projectId) {
        return;
      }

      if (!response.ok || !payload.data) {
        // A plain directory (no repository) is an expected state for the
        // Worktrees tab — the panel-level error state already covers it.
        setWorktreeData(null);
        return;
      }

      setWorktreeData(payload.data);
    } catch (error) {
      console.error('Error fetching worktrees:', error);
      if (selectedProjectIdRef.current === projectId) {
        setWorktreeData(null);
      }
    } finally {
      if (selectedProjectIdRef.current === projectId) {
        setIsLoading(false);
        setHasLoaded(true);
      }
    }
  }, [selectedProject]);

  useEffect(() => {
    setWorktreeData(null);
    setHasLoaded(false);
    setActionError(null);
    void fetchWorktrees();
  }, [fetchWorktrees]);

  const createWorktree = useCallback(
    async (branch: string, baseBranch: string | null, openAfterCreate: boolean) => {
      const trimmedBranch = branch.trim();
      if (!selectedProject || !trimmedBranch) {
        return false;
      }
      const projectId = selectedProject.projectId;

      setIsCreatingWorktree(true);
      setActionError(null);
      try {
        const response = await api.worktrees.create(projectId, {
          branch: trimmedBranch,
          baseBranch,
        });
        const payload = (await response.json()) as WorktreeApiEnvelope<WorktreeProjectPayload>;

        if (selectedProjectIdRef.current !== projectId) {
          return false;
        }

        if (!response.ok || !payload.data) {
          setActionError(readEnvelopeError(payload, 'Failed to create worktree'));
          return false;
        }

        onProjectsRefresh?.();
        if (openAfterCreate && payload.data.project && onProjectSelect) {
          onProjectSelect(payload.data.project);
        } else {
          void fetchWorktrees();
        }
        return true;
      } catch (error) {
        if (selectedProjectIdRef.current === projectId) {
          setActionError(error instanceof Error ? error.message : 'Failed to create worktree');
        }
        return false;
      } finally {
        setIsCreatingWorktree(false);
      }
    },
    [fetchWorktrees, onProjectSelect, onProjectsRefresh, selectedProject],
  );

  const openWorktree = useCallback(
    async (worktreePath: string) => {
      if (!selectedProject || activeWorktreeOperationRef.current !== null) {
        return false;
      }
      const projectId = selectedProject.projectId;
      const operationToken = Symbol('open-worktree');
      activeWorktreeOperationRef.current = operationToken;

      setBusyWorktreePath(worktreePath);
      setActionError(null);
      try {
        const response = await api.worktrees.open(projectId, worktreePath);
        const payload = (await response.json()) as WorktreeApiEnvelope<WorktreeProjectPayload>;

        if (selectedProjectIdRef.current !== projectId) {
          return false;
        }

        if (!response.ok || !payload.data?.project) {
          setActionError(readEnvelopeError(payload, 'Failed to open worktree'));
          return false;
        }

        onProjectsRefresh?.();
        onProjectSelect?.(payload.data.project);
        return true;
      } catch (error) {
        if (selectedProjectIdRef.current === projectId) {
          setActionError(error instanceof Error ? error.message : 'Failed to open worktree');
        }
        return false;
      } finally {
        if (activeWorktreeOperationRef.current === operationToken) {
          activeWorktreeOperationRef.current = null;
          setBusyWorktreePath(null);
        }
      }
    },
    [onProjectSelect, onProjectsRefresh, selectedProject],
  );

  const mergeWorktree = useCallback(
    async (worktreePath: string, options: MergeWorktreeOptions) => {
      if (!selectedProject || activeWorktreeOperationRef.current !== null) {
        return false;
      }
      const operationToken = Symbol('merge-worktree');
      activeWorktreeOperationRef.current = operationToken;

      setBusyWorktreePath(worktreePath);
      setActionError(null);
      try {
        const response = await api.worktrees.merge(selectedProject.projectId, worktreePath, {
          squash: options.squash,
          message: options.message,
          removeAfterMerge: options.removeAfterMerge,
        });
        const payload = (await response.json()) as WorktreeApiEnvelope<unknown>;

        if (!response.ok || !payload.success) {
          setActionError(readEnvelopeError(payload, 'Merge failed'));
          return false;
        }

        onProjectsRefresh?.();
        void fetchWorktrees();
        return true;
      } catch (error) {
        setActionError(error instanceof Error ? error.message : 'Merge failed');
        return false;
      } finally {
        if (activeWorktreeOperationRef.current === operationToken) {
          activeWorktreeOperationRef.current = null;
          setBusyWorktreePath(null);
        }
      }
    },
    [fetchWorktrees, onProjectsRefresh, selectedProject],
  );

  const removeWorktree = useCallback(
    async (worktreePath: string, options: RemoveWorktreeOptions) => {
      if (!selectedProject || activeWorktreeOperationRef.current !== null) {
        return false;
      }
      const operationToken = Symbol('remove-worktree');
      activeWorktreeOperationRef.current = operationToken;

      setBusyWorktreePath(worktreePath);
      setActionError(null);
      try {
        const response = await api.worktrees.remove(selectedProject.projectId, worktreePath, {
          force: options.force,
          deleteBranch: options.deleteBranch,
        });
        const payload = (await response.json()) as WorktreeApiEnvelope<unknown>;

        if (!response.ok || !payload.success) {
          setActionError(readEnvelopeError(payload, 'Failed to remove worktree'));
          return false;
        }

        onProjectsRefresh?.();
        void fetchWorktrees();
        return true;
      } catch (error) {
        setActionError(error instanceof Error ? error.message : 'Failed to remove worktree');
        return false;
      } finally {
        if (activeWorktreeOperationRef.current === operationToken) {
          activeWorktreeOperationRef.current = null;
          setBusyWorktreePath(null);
        }
      }
    },
    [fetchWorktrees, onProjectsRefresh, selectedProject],
  );

  return {
    worktreeData,
    // "Loading" until the first response lands so the empty state never
    // flashes before the data exists (same pattern as the History view).
    isLoading: isLoading || !hasLoaded,
    isCreatingWorktree,
    busyWorktreePath,
    actionError,
    clearActionError,
    refreshWorktrees: fetchWorktrees,
    createWorktree,
    openWorktree,
    mergeWorktree,
    removeWorktree,
  };
}
