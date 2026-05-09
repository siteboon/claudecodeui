import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../../utils/api';
import type { Project } from '../../../types/app';
import type { FileTreeNode } from '../types/types';

type UseFileTreeDataResult = {
  files: FileTreeNode[];
  loading: boolean;
  loadingDirs: Set<string>;
  refreshFiles: () => void;
  loadDirectoryChildren: (dirPath: string) => Promise<void>;
};

function insertChildren(tree: FileTreeNode[], dirPath: string, children: FileTreeNode[]): boolean {
  for (const node of tree) {
    if (node.path === dirPath) {
      node.children = children;
      return true;
    }
    if (node.children) {
      if (insertChildren(node.children, dirPath, children)) {
        return true;
      }
    }
  }
  return false;
}

export function useFileTreeData(selectedProject: Project | null): UseFileTreeDataResult {
  const [files, setFiles] = useState<FileTreeNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingDirs, setLoadingDirs] = useState<Set<string>>(() => new Set());
  const [refreshKey, setRefreshKey] = useState(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  const refreshFiles = useCallback(() => {
    setRefreshKey((prev) => prev + 1);
  }, []);

  useEffect(() => {
    const projectId = selectedProject?.projectId;

    if (!projectId) {
      setFiles([]);
      setLoading(false);
      return;
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    let isActive = true;

    const fetchFiles = async () => {
      if (isActive) {
        setLoading(true);
      }
      try {
        const response = await api.getFiles(projectId, { signal: abortControllerRef.current!.signal });

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
  }, [selectedProject?.projectId, refreshKey]);

  const loadDirectoryChildren = useCallback(async (dirPath: string) => {
    const projectId = selectedProject?.projectId;
    if (!projectId) return;

    setLoadingDirs((prev) => new Set(prev).add(dirPath));

    try {
      const response = await api.getFileChildren(projectId, dirPath);
      if (!response.ok) return;

      const children = (await response.json()) as FileTreeNode[];
      setFiles((prevFiles) => {
        const newTree = JSON.parse(JSON.stringify(prevFiles)) as FileTreeNode[];
        insertChildren(newTree, dirPath, children);
        return newTree;
      });
    } catch (error) {
      console.error('Error loading directory children:', error);
    } finally {
      setLoadingDirs((prev) => {
        const next = new Set(prev);
        next.delete(dirPath);
        return next;
      });
    }
  }, [selectedProject?.projectId]);

  return {
    files,
    loading,
    loadingDirs,
    refreshFiles,
    loadDirectoryChildren,
  };
}
