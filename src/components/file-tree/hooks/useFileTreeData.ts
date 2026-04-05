import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../../utils/api';
import type { Project } from '../../../types/app';
import type { FileTreeNode } from '../types/types';

const AUTO_REFRESH_INTERVAL_MS = 1000;

type UseFileTreeDataResult = {
  files: FileTreeNode[];
  loading: boolean;
  refreshFiles: () => void;
};

export function useFileTreeData(selectedProject: Project | null): UseFileTreeDataResult {
  const [files, setFiles] = useState<FileTreeNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const pollAbortControllerRef = useRef<AbortController | null>(null);

  const refreshFiles = useCallback(() => {
    setRefreshKey((prev) => prev + 1);
  }, []);

  // Primary fetch: triggered on project change or manual refresh. Shows loading state.
  useEffect(() => {
    const projectName = selectedProject?.name;

    if (!projectName) {
      setFiles([]);
      setLoading(false);
      return;
    }

    // Abort previous request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    // Track mount state so aborted or late responses do not enqueue stale state updates.
    let isActive = true;

    const fetchFiles = async () => {
      if (isActive) {
        setLoading(true);
      }
      try {
        const response = await api.getFiles(projectName, { signal: abortControllerRef.current!.signal });

        if (!response.ok) {
          const errorText = await response.text();
          console.error('File fetch failed:', response.status, errorText);
          if (isActive) {
            setFiles([]);
          }
          return;
        }

        const data = (await response.json()) as FileTreeNode[];
        if (isActive) {
          setFiles(data);
        }
      } catch (error) {
        if ((error as { name?: string }).name === 'AbortError') {
          return;
        }

        console.error('Error fetching files:', error);
        if (isActive) {
          setFiles([]);
        }
      } finally {
        if (isActive) {
          setLoading(false);
        }
      }
    };

    void fetchFiles();

    return () => {
      isActive = false;
      abortControllerRef.current?.abort();
    };
  }, [selectedProject?.name, refreshKey]);

  // Auto-refresh: silently poll every second without showing loading indicator.
  useEffect(() => {
    const projectName = selectedProject?.name;
    if (!projectName) {
      return;
    }

    const pollFiles = async () => {
      // Abort any previous poll still in flight
      if (pollAbortControllerRef.current) {
        pollAbortControllerRef.current.abort();
      }
      const controller = new AbortController();
      pollAbortControllerRef.current = controller;

      try {
        const response = await api.getFiles(projectName, { signal: controller.signal });
        if (!response.ok) {
          return;
        }
        const data = (await response.json()) as FileTreeNode[];
        if (!controller.signal.aborted) {
          setFiles(data);
        }
      } catch {
        // Silently ignore poll errors (abort, network, etc.)
      }
    };

    const intervalId = setInterval(pollFiles, AUTO_REFRESH_INTERVAL_MS);

    return () => {
      clearInterval(intervalId);
      pollAbortControllerRef.current?.abort();
    };
  }, [selectedProject?.name]);

  return {
    files,
    loading,
    refreshFiles,
  };
}
