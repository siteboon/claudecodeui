import { useCallback, useEffect, useMemo, useState } from 'react';

import { api } from '@/shared/api';
import type { GitRepositorySummary, Project } from '@/shared/types';
import { resolveRepositorySelection } from '@/modules/git-panel/utils/gitPanelUtils';

const STORAGE_KEY_PREFIX = 'git-panel-repository:';

type RepositoryScan = { projectId: string; repositories: GitRepositorySummary[] };
type RepositorySelection = { projectId: string; path: string };

function readStoredSelection(projectId: string): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY_PREFIX + projectId);
  } catch {
    return null;
  }
}

function writeStoredSelection(projectId: string, path: string): void {
  try {
    localStorage.setItem(STORAGE_KEY_PREFIX + projectId, path);
  } catch {
    // Persistence is a convenience; the selection still applies for this page.
  }
}

/**
 * Lists the repositories under the selected project and remembers, per
 * project, which one the Source Control panel shows.
 */
export function useGitRepositories(selectedProject: Project | null) {
  const projectId = selectedProject?.projectId ?? null;
  // Result of the last repository scan, tagged with its project so a stale
  // answer for a previous project is ignored rather than shown.
  const [scan, setScan] = useState<RepositoryScan | null>(null);
  // The user's explicit choice for the current project; anything else is
  // derived from the scan and the remembered choice in localStorage.
  const [selection, setSelection] = useState<RepositorySelection | null>(null);

  useEffect(() => {
    if (!projectId) {
      return;
    }
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await api.git.repositories(projectId, { signal: controller.signal });
        if (!response.ok || controller.signal.aborted) {
          return;
        }
        const data = (await response.json()) as { repositories?: GitRepositorySummary[] };
        if (controller.signal.aborted) {
          return;
        }
        setScan({ projectId, repositories: Array.isArray(data.repositories) ? data.repositories : [] });
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          console.error('Error listing repositories:', error);
        }
      }
    })();
    return () => controller.abort();
  }, [projectId]);

  const repositories = useMemo(
    () => (scan && scan.projectId === projectId ? scan.repositories : []),
    [projectId, scan],
  );

  const selectedRepositoryPath = useMemo(() => {
    if (!projectId) {
      return '';
    }
    const chosen = selection && selection.projectId === projectId ? selection.path : readStoredSelection(projectId);
    return resolveRepositorySelection(repositories, chosen);
  }, [projectId, repositories, selection]);

  const selectRepository = useCallback((path: string) => {
    if (!projectId) {
      return;
    }
    setSelection({ projectId, path });
    writeStoredSelection(projectId, path);
  }, [projectId]);

  return { repositories, selectedRepositoryPath, selectRepository };
}
