import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { api } from '@/shared/api';
import type { Project, FileTreeNode } from '@/shared/types';

type DirectoryPage = {
  entries: FileTreeNode[]; nextCursor: string | null; cursor: string;
  previous: string[]; loading: boolean; error: string | null;
};

/** FileTree owns this cache: one bounded page per visited folder, reset on refresh/project change. */
export function useFileTreeData(selectedProject: Project | null) {
  // Retain only requested directory pages, their navigation history and request feedback.
  const [pages, setPages] = useState<Record<string, DirectoryPage>>({});
  // Invalidates all pages after file mutations or a manual refresh.
  const [revision, setRevision] = useState(0);
  const generation = useRef(0);
  const pending = useRef(new Map<string, AbortController>());
  const cache = useRef<Record<string, DirectoryPage>>({});
  const projectId = selectedProject?.projectId;

  const loadDirectory = useCallback(async (directory = '', direction: 'initial' | 'next' | 'previous' | 'retry' = 'initial') => {
    if (!projectId || pending.current.has(directory)) return;
    const old = cache.current[directory];
    if (direction === 'initial' && old) return;
    if (direction === 'next' && !old?.nextCursor) return;
    if (direction === 'previous' && !old?.previous.length) return;
    const previous = direction === 'next' ? [...(old?.previous ?? []), old?.cursor ?? '']
      : direction === 'previous' ? old!.previous.slice(0, -1) : [];
    const cursor = direction === 'next' ? old!.nextCursor!
      : direction === 'previous' ? old!.previous[old!.previous.length - 1] : '';
    const controller = new AbortController();
    const currentGeneration = generation.current;
    pending.current.set(directory, controller);
    const update = (page: DirectoryPage) => {
      if (currentGeneration !== generation.current) return;
      cache.current = { ...cache.current, [directory]: page };
      setPages(cache.current);
    };
    update({ entries: old?.entries ?? [], nextCursor: old?.nextCursor ?? null,
      cursor: old?.cursor ?? '', previous: old?.previous ?? [], loading: true, error: null });
    try {
      const response = await api.getDirectoryPage(projectId, directory, cursor, { signal: controller.signal });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Unable to load folder');
      update({ entries: body.entries, nextCursor: body.nextCursor, cursor, previous, loading: false, error: null });
    } catch (error) {
      if (!controller.signal.aborted) update({ entries: old?.entries ?? [], nextCursor: old?.nextCursor ?? null,
        cursor: old?.cursor ?? '', previous: old?.previous ?? [], loading: false,
        error: error instanceof Error ? error.message : 'Unable to load folder' });
    } finally {
      if (currentGeneration === generation.current) pending.current.delete(directory);
    }
  }, [projectId]);

  useEffect(() => {
    const requests = pending.current;
    generation.current += 1;
    for (const request of requests.values()) request.abort();
    requests.clear();
    cache.current = {};
    setPages({});
    void loadDirectory();
    return () => {
      generation.current += 1;
      for (const request of requests.values()) request.abort();
      requests.clear();
    };
  }, [loadDirectory, revision]);

  const files = useMemo(() => {
    const attach = (entries: FileTreeNode[]): FileTreeNode[] => entries.map(entry => ({ ...entry,
      ...(entry.type === 'directory' && pages[entry.path] ? { children: attach(pages[entry.path].entries) } : {}),
    }));
    return attach(pages['']?.entries ?? []);
  }, [pages]);
  const refreshFiles = useCallback(() => setRevision(value => value + 1), []);
  return { files, pages, loadDirectory, refreshFiles,
    loading: Boolean(projectId && (!pages[''] || (pages[''].loading && !pages[''].entries.length))),
    error: pages['']?.error ?? null };
}
