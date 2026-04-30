import { useEffect, useState } from 'react';

import { api } from '../../../utils/api';

export type FileResult = {
  path: string;
  name: string;
};

interface FileNode {
  type: 'file' | 'directory';
  name: string;
  path: string;
  children?: FileNode[];
}

const MAX_FILES = 500;

function flatten(nodes: FileNode[], out: FileResult[]): void {
  for (const node of nodes) {
    if (out.length >= MAX_FILES) return;
    if (node.type === 'file') {
      out.push({ path: node.path, name: node.name });
    } else if (node.children && node.children.length > 0) {
      flatten(node.children, out);
    }
  }
}

export function useFilesSource(projectId: string | undefined, enabled: boolean) {
  const [items, setItems] = useState<FileResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!enabled || !projectId) {
      setItems([]);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    api
      .getFiles(projectId)
      .then((r) => r.json())
      .then((data: unknown) => {
        if (cancelled) return;
        const tree: FileNode[] = Array.isArray(data) ? (data as FileNode[]) : [];
        const flat: FileResult[] = [];
        flatten(tree, flat);
        setItems(flat);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, enabled]);

  return { items, isLoading };
}
