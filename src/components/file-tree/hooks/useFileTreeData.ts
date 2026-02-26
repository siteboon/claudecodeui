import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../../utils/api';
import type { Project } from '../../../types/app';
import type { FileTreeNode } from '../types/types';

type UseFileTreeDataResult = {
  files: FileTreeNode[];
  loading: boolean;
  refresh: () => void;
};

export function useFileTreeData(selectedProject: Project | null): UseFileTreeDataResult {
  const [files, setFiles] = useState<FileTreeNode[]>([]);
  const [loading, setLoading] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const isActiveRef = useRef(true);

  const fetchFiles = useCallback(async () => {
    const projectName = selectedProject?.name;

    if (!projectName) {
      setFiles([]);
      setLoading(false);
      return;
    }

    // Abort any previous request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    if (isActiveRef.current) {
      setLoading(true);
    }
    try {
      const response = await api.getFiles(projectName, { signal: abortControllerRef.current.signal });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('File fetch failed:', response.status, errorText);
        if (isActiveRef.current) {
          setFiles([]);
        }
        return;
      }

      const data = (await response.json()) as FileTreeNode[];
      if (isActiveRef.current) {
        setFiles(data);
      }
    } catch (error) {
      if ((error as { name?: string }).name === 'AbortError') {
        return;
      }

      console.error('Error fetching files:', error);
      if (isActiveRef.current) {
        setFiles([]);
      }
    } finally {
      if (isActiveRef.current) {
        setLoading(false);
      }
    }
  }, [selectedProject?.name]);

  const refresh = useCallback(() => {
    void fetchFiles();
  }, [fetchFiles]);

  useEffect(() => {
    isActiveRef.current = true;
    void fetchFiles();

    return () => {
      isActiveRef.current = false;
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [fetchFiles]);

  return {
    files,
    loading,
    refresh,
  };
}
