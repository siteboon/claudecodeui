import { useCallback, useEffect, useMemo, useState } from 'react';

import { api } from '@/shared/api';
import type { GitRepositorySummary, Project } from '@/shared/types';
import { resolveRepositorySelection } from '@/modules/git-panel/utils/gitPanelUtils';

const STORAGE_KEY_PREFIX = 'git-panel-repository:';

type RepositoryScan =
  | { projectId: string; status: 'ok'; repositories: GitRepositorySummary[] }
  | { projectId: string; status: 'failed'; attempt: number };

/** A failed scan is retried this many times, with a growing pause between tries. */
const SCAN_RETRY_LIMIT = 3;
const SCAN_RETRY_BASE_MS = 2_000;
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
  // Bumped to run the scan again after a failure; tagged with its project so a
  // newly opened project starts over.
  const [retry, setRetry] = useState<{ projectId: string | null; attempt: number }>({ projectId: null, attempt: 0 });
  const scanAttempt = retry.projectId === projectId ? retry.attempt : 0;
  // The user's explicit choice for the current project; anything else is
  // derived from the scan and the remembered choice in localStorage.
  const [selection, setSelection] = useState<RepositorySelection | null>(null);

  useEffect(() => {
    if (!projectId) {
      return;
    }
    const controller = new AbortController();
    const recordFailure = () => {
      if (!controller.signal.aborted) {
        setScan({ projectId, status: 'failed', attempt: scanAttempt });
      }
    };
    void (async () => {
      try {
        const response = await api.git.repositories(projectId, { signal: controller.signal });
        if (controller.signal.aborted) {
          return;
        }
        if (!response.ok) {
          recordFailure();
          return;
        }
        const data = (await response.json()) as { repositories?: GitRepositorySummary[] };
        if (controller.signal.aborted) {
          return;
        }
        setScan({ projectId, status: 'ok', repositories: Array.isArray(data.repositories) ? data.repositories : [] });
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          console.error('Error listing repositories:', error);
          recordFailure();
        }
      }
    })();
    return () => controller.abort();
  }, [projectId, scanAttempt]);

  // A failed scan leaves the selection unknown, so "git init" stays off and the
  // scan is tried again a few times rather than treating failure as "no repos".
  useEffect(() => {
    if (!scan || scan.projectId !== projectId || scan.status !== 'failed' || scan.attempt >= SCAN_RETRY_LIMIT) {
      return undefined;
    }
    const timer = setTimeout(
      () => setRetry({ projectId: scan.projectId, attempt: scan.attempt + 1 }),
      SCAN_RETRY_BASE_MS * (scan.attempt + 1),
    );
    return () => clearTimeout(timer);
  }, [projectId, scan]);

  const repositories = useMemo(
    () => (scan && scan.projectId === projectId && scan.status === 'ok' ? scan.repositories : []),
    [projectId, scan],
  );
  // Until the scan for this project settles, the selected repository is not
  // known yet, so nothing may act on the project root in its place.
  const isRepositoryScanComplete = Boolean(scan && scan.projectId === projectId && scan.status === 'ok');

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

  return { repositories, selectedRepositoryPath, selectRepository, isRepositoryScanComplete };
}
