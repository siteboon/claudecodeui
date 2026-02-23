import { useCallback, useEffect, useRef, useState } from 'react';
import { authenticatedFetch } from '../../../utils/api';
import { DEFAULT_BRANCH, RECENT_COMMITS_LIMIT } from '../constants/constants';
import type {
  GitApiErrorResponse,
  GitBranchesResponse,
  GitCommitSummary,
  GitCommitsResponse,
  GitDiffMap,
  GitDiffResponse,
  GitFileWithDiffResponse,
  GitGenerateMessageResponse,
  GitOperationResponse,
  GitPanelController,
  GitRemoteStatus,
  GitStatusResponse,
  UseGitPanelControllerOptions,
} from '../types/types';
import { getAllChangedFiles } from '../utils/gitPanelUtils';
import { useSelectedProvider } from './useSelectedProvider';

// ! use authenticatedFetch directly. fetchWithAuth is redundant 
const fetchWithAuth = authenticatedFetch as (url: string, options?: RequestInit) => Promise<Response>;

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

async function readJson<T>(response: Response, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) {
    throw new DOMException('Request aborted', 'AbortError');
  }

  const data = (await response.json()) as T;

  if (signal?.aborted) {
    throw new DOMException('Request aborted', 'AbortError');
  }

  return data;
}

export function useGitPanelController({
  selectedProject,
  activeView,
  onFileOpen,
}: UseGitPanelControllerOptions): GitPanelController {
  const [gitStatus, setGitStatus] = useState<GitStatusResponse | null>(null);
  const [gitDiff, setGitDiff] = useState<GitDiffMap>({});
  const [isLoading, setIsLoading] = useState(false);
  const [currentBranch, setCurrentBranch] = useState('');
  const [branches, setBranches] = useState<string[]>([]);
  const [recentCommits, setRecentCommits] = useState<GitCommitSummary[]>([]);
  const [commitDiffs, setCommitDiffs] = useState<GitDiffMap>({});
  const [remoteStatus, setRemoteStatus] = useState<GitRemoteStatus | null>(null);
  const [isCreatingBranch, setIsCreatingBranch] = useState(false);
  const [isFetching, setIsFetching] = useState(false);
  const [isPulling, setIsPulling] = useState(false);
  const [isPushing, setIsPushing] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [isCreatingInitialCommit, setIsCreatingInitialCommit] = useState(false);
  const selectedProjectNameRef = useRef<string | null>(selectedProject?.name ?? null);

  useEffect(() => {
    selectedProjectNameRef.current = selectedProject?.name ?? null;
  }, [selectedProject]);

  const provider = useSelectedProvider();

  const fetchFileDiff = useCallback(
    async (filePath: string, signal?: AbortSignal) => {
      if (!selectedProject) {
        return;
      }

      const projectName = selectedProject.name;

      try {
        const response = await fetchWithAuth(
          `/api/git/diff?project=${encodeURIComponent(projectName)}&file=${encodeURIComponent(filePath)}`,
          { signal },
        );
        const data = await readJson<GitDiffResponse>(response, signal);

        if (
          signal?.aborted ||
          selectedProjectNameRef.current !== projectName ||
          selectedProject.name !== projectName
        ) {
          return;
        }

        if (!data.error && data.diff) {
          setGitDiff((previous) => ({
            ...previous,
            [filePath]: data.diff as string,
          }));
        }
      } catch (error) {
        if (signal?.aborted || isAbortError(error)) {
          return;
        }

        console.error('Error fetching file diff:', error);
      }
    },
    [selectedProject],
  );

  const fetchGitStatus = useCallback(async (signal?: AbortSignal) => {
    if (!selectedProject) {
      return;
    }

    const projectName = selectedProject.name;

    setIsLoading(true);
    try {
      const response = await fetchWithAuth(`/api/git/status?project=${encodeURIComponent(projectName)}`, { signal });
      const data = await readJson<GitStatusResponse>(response, signal);

      if (
        signal?.aborted ||
        selectedProjectNameRef.current !== projectName ||
        selectedProject.name !== projectName
      ) {
        return;
      }

      if (data.error) {
        console.error('Git status error:', data.error);
        setGitStatus({ error: data.error, details: data.details });
        setCurrentBranch('');
        return;
      }

      setGitStatus(data);
      setCurrentBranch(data.branch || DEFAULT_BRANCH);

      const changedFiles = getAllChangedFiles(data);
      changedFiles.forEach((filePath) => {
        void fetchFileDiff(filePath, signal);
      });
    } catch (error) {
      if (signal?.aborted || isAbortError(error)) {
        return;
      }

      if (
        selectedProjectNameRef.current !== projectName ||
        selectedProject.name !== projectName
      ) {
        return;
      }

      console.error('Error fetching git status:', error);
      setGitStatus({ error: 'Git operation failed', details: String(error) });
      setCurrentBranch('');
    } finally {
      if (
        signal?.aborted ||
        selectedProjectNameRef.current !== projectName ||
        selectedProject.name !== projectName
      ) {
        return;
      }

      setIsLoading(false);
    }
  }, [fetchFileDiff, selectedProject]);

  const fetchBranches = useCallback(async () => {
    if (!selectedProject) {
      return;
    }

    try {
      const response = await fetchWithAuth(`/api/git/branches?project=${encodeURIComponent(selectedProject.name)}`);
      const data = await readJson<GitBranchesResponse>(response);

      if (!data.error && data.branches) {
        setBranches(data.branches);
        return;
      }

      setBranches([]);
    } catch (error) {
      console.error('Error fetching branches:', error);
      setBranches([]);
    }
  }, [selectedProject]);

  const fetchRemoteStatus = useCallback(async () => {
    if (!selectedProject) {
      return;
    }

    try {
      const response = await fetchWithAuth(`/api/git/remote-status?project=${encodeURIComponent(selectedProject.name)}`);
      const data = await readJson<GitRemoteStatus | GitApiErrorResponse>(response);

      if (!data.error) {
        setRemoteStatus(data as GitRemoteStatus);
        return;
      }

      setRemoteStatus(null);
    } catch (error) {
      console.error('Error fetching remote status:', error);
      setRemoteStatus(null);
    }
  }, [selectedProject]);

  const switchBranch = useCallback(
    async (branchName: string) => {
      if (!selectedProject) {
        return false;
      }

      try {
        const response = await fetchWithAuth('/api/git/checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            project: selectedProject.name,
            branch: branchName,
          }),
        });

        const data = await readJson<GitOperationResponse>(response);
        if (!data.success) {
          console.error('Failed to switch branch:', data.error);
          return false;
        }

        setCurrentBranch(branchName);
        void fetchGitStatus();
        return true;
      } catch (error) {
        console.error('Error switching branch:', error);
        return false;
      }
    },
    [fetchGitStatus, selectedProject],
  );

  const createBranch = useCallback(
    async (branchName: string) => {
      const trimmedBranchName = branchName.trim();
      if (!selectedProject || !trimmedBranchName) {
        return false;
      }

      setIsCreatingBranch(true);
      try {
        const response = await fetchWithAuth('/api/git/create-branch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            project: selectedProject.name,
            branch: trimmedBranchName,
          }),
        });

        const data = await readJson<GitOperationResponse>(response);
        if (!data.success) {
          console.error('Failed to create branch:', data.error);
          return false;
        }

        setCurrentBranch(trimmedBranchName);
        void fetchBranches();
        void fetchGitStatus();
        return true;
      } catch (error) {
        console.error('Error creating branch:', error);
        return false;
      } finally {
        setIsCreatingBranch(false);
      }
    },
    [fetchBranches, fetchGitStatus, selectedProject],
  );

  const handleFetch = useCallback(async () => {
    if (!selectedProject) {
      return;
    }

    setIsFetching(true);
    try {
      const response = await fetchWithAuth('/api/git/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project: selectedProject.name,
        }),
      });

      const data = await readJson<GitOperationResponse>(response);
      if (data.success) {
        void fetchGitStatus();
        void fetchRemoteStatus();
        return;
      }

      console.error('Fetch failed:', data.error);
    } catch (error) {
      console.error('Error fetching from remote:', error);
    } finally {
      setIsFetching(false);
    }
  }, [fetchGitStatus, fetchRemoteStatus, selectedProject]);

  const handlePull = useCallback(async () => {
    if (!selectedProject) {
      return;
    }

    setIsPulling(true);
    try {
      const response = await fetchWithAuth('/api/git/pull', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project: selectedProject.name,
        }),
      });

      const data = await readJson<GitOperationResponse>(response);
      if (data.success) {
        void fetchGitStatus();
        void fetchRemoteStatus();
        return;
      }

      console.error('Pull failed:', data.error);
    } catch (error) {
      console.error('Error pulling from remote:', error);
    } finally {
      setIsPulling(false);
    }
  }, [fetchGitStatus, fetchRemoteStatus, selectedProject]);

  const handlePush = useCallback(async () => {
    if (!selectedProject) {
      return;
    }

    setIsPushing(true);
    try {
      const response = await fetchWithAuth('/api/git/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project: selectedProject.name,
        }),
      });

      const data = await readJson<GitOperationResponse>(response);
      if (data.success) {
        void fetchGitStatus();
        void fetchRemoteStatus();
        return;
      }

      console.error('Push failed:', data.error);
    } catch (error) {
      console.error('Error pushing to remote:', error);
    } finally {
      setIsPushing(false);
    }
  }, [fetchGitStatus, fetchRemoteStatus, selectedProject]);

  const handlePublish = useCallback(async () => {
    if (!selectedProject) {
      return;
    }

    setIsPublishing(true);
    try {
      const response = await fetchWithAuth('/api/git/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project: selectedProject.name,
          branch: currentBranch,
        }),
      });

      const data = await readJson<GitOperationResponse>(response);
      if (data.success) {
        void fetchGitStatus();
        void fetchRemoteStatus();
        return;
      }

      console.error('Publish failed:', data.error);
    } catch (error) {
      console.error('Error publishing branch:', error);
    } finally {
      setIsPublishing(false);
    }
  }, [currentBranch, fetchGitStatus, fetchRemoteStatus, selectedProject]);

  const discardChanges = useCallback(
    async (filePath: string) => {
      if (!selectedProject) {
        return;
      }

      try {
        const response = await fetchWithAuth('/api/git/discard', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            project: selectedProject.name,
            file: filePath,
          }),
        });

        const data = await readJson<GitOperationResponse>(response);
        if (data.success) {
          void fetchGitStatus();
          return;
        }

        console.error('Discard failed:', data.error);
      } catch (error) {
        console.error('Error discarding changes:', error);
      }
    },
    [fetchGitStatus, selectedProject],
  );

  const deleteUntrackedFile = useCallback(
    async (filePath: string) => {
      if (!selectedProject) {
        return;
      }

      try {
        const response = await fetchWithAuth('/api/git/delete-untracked', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            project: selectedProject.name,
            file: filePath,
          }),
        });

        const data = await readJson<GitOperationResponse>(response);
        if (data.success) {
          void fetchGitStatus();
          return;
        }

        console.error('Delete failed:', data.error);
      } catch (error) {
        console.error('Error deleting untracked file:', error);
      }
    },
    [fetchGitStatus, selectedProject],
  );

  const fetchRecentCommits = useCallback(async () => {
    if (!selectedProject) {
      return;
    }

    try {
      const response = await fetchWithAuth(
        `/api/git/commits?project=${encodeURIComponent(selectedProject.name)}&limit=${RECENT_COMMITS_LIMIT}`,
      );
      const data = await readJson<GitCommitsResponse>(response);

      if (!data.error && data.commits) {
        setRecentCommits(data.commits);
      }
    } catch (error) {
      console.error('Error fetching commits:', error);
    }
  }, [selectedProject]);

  const fetchCommitDiff = useCallback(
    async (commitHash: string) => {
      if (!selectedProject) {
        return;
      }

      try {
        const response = await fetchWithAuth(
          `/api/git/commit-diff?project=${encodeURIComponent(selectedProject.name)}&commit=${commitHash}`,
        );
        const data = await readJson<GitDiffResponse>(response);

        if (!data.error && data.diff) {
          setCommitDiffs((previous) => ({
            ...previous,
            [commitHash]: data.diff as string,
          }));
        }
      } catch (error) {
        console.error('Error fetching commit diff:', error);
      }
    },
    [selectedProject],
  );

  const generateCommitMessage = useCallback(
    async (files: string[]) => {
      if (!selectedProject || files.length === 0) {
        return null;
      }

      try {
        const response = await authenticatedFetch('/api/git/generate-commit-message', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            project: selectedProject.name,
            files,
            provider,
          }),
        });

        const data = await readJson<GitGenerateMessageResponse>(response);
        if (data.message) {
          return data.message;
        }

        console.error('Failed to generate commit message:', data.error);
        return null;
      } catch (error) {
        console.error('Error generating commit message:', error);
        return null;
      }
    },
    [provider, selectedProject],
  );

  const commitChanges = useCallback(
    async (message: string, files: string[]) => {
      if (!selectedProject || !message.trim() || files.length === 0) {
        return false;
      }

      try {
        const response = await fetchWithAuth('/api/git/commit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            project: selectedProject.name,
            message,
            files,
          }),
        });

        const data = await readJson<GitOperationResponse>(response);
        if (data.success) {
          void fetchGitStatus();
          void fetchRemoteStatus();
          return true;
        }

        console.error('Commit failed:', data.error);
        return false;
      } catch (error) {
        console.error('Error committing changes:', error);
        return false;
      }
    },
    [fetchGitStatus, fetchRemoteStatus, selectedProject],
  );

  const createInitialCommit = useCallback(async () => {
    if (!selectedProject) {
      return false;
    }

    setIsCreatingInitialCommit(true);
    try {
      const response = await fetchWithAuth('/api/git/initial-commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project: selectedProject.name,
        }),
      });

      const data = await readJson<GitOperationResponse>(response);
      if (data.success) {
        void fetchGitStatus();
        void fetchRemoteStatus();
        return true;
      }

      console.error('Initial commit failed:', data.error);
      throw new Error(data.error || 'Failed to create initial commit');
    } catch (error) {
      console.error('Error creating initial commit:', error);
      throw new Error((error as { message?: string })?.message || 'Failed to create initial commit');
    } finally {
      setIsCreatingInitialCommit(false);
    }
  }, [fetchGitStatus, fetchRemoteStatus, selectedProject]);

  const openFile = useCallback(
    async (filePath: string) => {
      if (!onFileOpen) {
        return;
      }

      if (!selectedProject) {
        onFileOpen(filePath);
        return;
      }

      try {
        const response = await fetchWithAuth(
          `/api/git/file-with-diff?project=${encodeURIComponent(selectedProject.name)}&file=${encodeURIComponent(filePath)}`,
        );
        const data = await readJson<GitFileWithDiffResponse>(response);

        if (data.error) {
          console.error('Error fetching file with diff:', data.error);
          onFileOpen(filePath);
          return;
        }

        onFileOpen(filePath, {
          old_string: data.oldContent || '',
          new_string: data.currentContent || '',
        });
      } catch (error) {
        console.error('Error opening file:', error);
        onFileOpen(filePath);
      }
    },
    [onFileOpen, selectedProject],
  );

  const refreshAll = useCallback(() => {
    void fetchGitStatus();
    void fetchBranches();
    void fetchRemoteStatus();
  }, [fetchBranches, fetchGitStatus, fetchRemoteStatus]);

  useEffect(() => {
    const controller = new AbortController();

    // Reset repository-scoped state when project changes to avoid stale UI.
    setCurrentBranch('');
    setBranches([]);
    setGitStatus(null);
    setRemoteStatus(null);
    setGitDiff({});
    setRecentCommits([]);
    setCommitDiffs({});
    setIsLoading(false);

    if (!selectedProject) {
      return () => {
        controller.abort();
      };
    }

    void fetchGitStatus(controller.signal);
    void fetchBranches();
    void fetchRemoteStatus();

    return () => {
      controller.abort();
    };
  }, [fetchBranches, fetchGitStatus, fetchRemoteStatus, selectedProject]);

  useEffect(() => {
    if (!selectedProject || activeView !== 'history') {
      return;
    }

    void fetchRecentCommits();
  }, [activeView, fetchRecentCommits, selectedProject]);

  return {
    gitStatus,
    gitDiff,
    isLoading,
    currentBranch,
    branches,
    recentCommits,
    commitDiffs,
    remoteStatus,
    isCreatingBranch,
    isFetching,
    isPulling,
    isPushing,
    isPublishing,
    isCreatingInitialCommit,
    refreshAll,
    switchBranch,
    createBranch,
    handleFetch,
    handlePull,
    handlePush,
    handlePublish,
    discardChanges,
    deleteUntrackedFile,
    fetchCommitDiff,
    generateCommitMessage,
    commitChanges,
    createInitialCommit,
    openFile,
  };
}
