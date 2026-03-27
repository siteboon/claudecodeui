import { useState, useEffect, useCallback } from 'react';
import { fetchWorkspaces } from '../data/workspacesApi';
import type { Project } from '@/types/app';

/**
 * Hook layer (The Manager)
 * Manages fetching workspaces and loading states.
 */
export const useWorkspaces = () => {
  const [workspaces, setWorkspaces] = useState<Project[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const refreshWorkspaces = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const data = await fetchWorkspaces();
      setWorkspaces(data);
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  // Fetch on mount
  useEffect(() => {
    refreshWorkspaces();
  }, [refreshWorkspaces]);

  return {
    workspaces,
    isRefreshing,
    refreshWorkspaces,
  };
};
