import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '@/shared/api';
import type { FileOpenHandler, GitApiErrorResponse, GitCommitSummary, GitDiffMap, GitOperationResponse, GitPanelView, GitRemoteStatus, GitStatusResponse, Project } from '@/shared/types';
import { getAllChangedFiles } from '@/modules/git-panel/utils/gitPanelUtils';
import { useSelectedProvider } from '@/modules/git-panel/hooks/useSelectedProvider';

const DEFAULT_BRANCH = 'main';
// High enough for the commit graph to show meaningful branch structure.
const RECENT_COMMITS_LIMIT = 50;

type UseGitPanelControllerOptions = {
  selectedProject: Project | null;
  activeView: GitPanelView;
  onFileOpen?: FileOpenHandler;
};

type GitPanelController = {
  gitStatus: GitStatusResponse | null;
  gitDiff: GitDiffMap;
  isLoading: boolean;
  isLoadingCommits: boolean;
  currentBranch: string;
  branches: string[];
  localBranches: string[];
  remoteBranches: string[];
  recentCommits: GitCommitSummary[];
  commitDiffs: GitDiffMap;
  remoteStatus: GitRemoteStatus | null;
  isCreatingBranch: boolean;
  isFetching: boolean;
  isPulling: boolean;
  isPushing: boolean;
  isPublishing: boolean;
  isCreatingInitialCommit: boolean;
  isInitializingRepository: boolean;
  operationError: string | null;
  clearOperationError: () => void;
  refreshAll: () => void;
  switchBranch: (branchName: string) => Promise<boolean>;
  createBranch: (branchName: string) => Promise<boolean>;
  deleteBranch: (branchName: string, force?: boolean) => Promise<boolean>;
  handleFetch: () => Promise<void>;
  handlePull: () => Promise<void>;
  handlePush: () => Promise<void>;
  handlePublish: () => Promise<void>;
  discardChanges: (filePath: string) => Promise<void>;
  deleteUntrackedFile: (filePath: string) => Promise<void>;
  stageFiles: (files: string[]) => Promise<boolean>;
  unstageFiles: (files: string[]) => Promise<boolean>;
  fetchCommitDiff: (commitHash: string) => Promise<void>;
  generateCommitMessage: (files: string[]) => Promise<string | null>;
  commitChanges: (message: string, files: string[]) => Promise<boolean>;
  createInitialCommit: () => Promise<boolean>;
  initRepository: () => Promise<boolean>;
  openFile: (filePath: string) => Promise<void>;
};

type GitDiffResponse = GitApiErrorResponse & {
  diff?: string;
};

type GitBranchesResponse = GitApiErrorResponse & {
  branches?: string[];
  localBranches?: string[];
  remoteBranches?: string[];
};

type GitCommitsResponse = GitApiErrorResponse & {
  commits?: GitCommitSummary[];
};

type GitGenerateMessageResponse = GitApiErrorResponse & {
  message?: string;
};

type GitFileWithDiffResponse = GitApiErrorResponse & {
  oldContent?: string;
  currentContent?: string;
  isDeleted?: boolean;
  isUntracked?: boolean;
};

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
  // Separate from `isLoading` (status) so History never flashes "No commits
  // found" while the commits request is still in flight.
  const [isLoadingCommits, setIsLoadingCommits] = useState(false);
  const [hasLoadedCommits, setHasLoadedCommits] = useState(false);
  const [commitDiffs, setCommitDiffs] = useState<GitDiffMap>({});
  const [remoteStatus, setRemoteStatus] = useState<GitRemoteStatus | null>(null);
  const [localBranches, setLocalBranches] = useState<string[]>([]);
  const [remoteBranches, setRemoteBranches] = useState<string[]>([]);
  const [isCreatingBranch, setIsCreatingBranch] = useState(false);
  const [isFetching, setIsFetching] = useState(false);
  const [isPulling, setIsPulling] = useState(false);
  const [isPushing, setIsPushing] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [isCreatingInitialCommit, setIsCreatingInitialCommit] = useState(false);
  const [isInitializingRepository, setIsInitializingRepository] = useState(false);
  const [operationError, setOperationError] = useState<string | null>(null);

  const clearOperationError = useCallback(() => setOperationError(null), []);
  // Tracks the DB projectId so async requests can detect stale responses when
  // the user switches projects mid-flight.
  const selectedProjectIdRef = useRef<string | null>(selectedProject?.projectId ?? null);

  useEffect(() => {
    selectedProjectIdRef.current = selectedProject?.projectId ?? null;
  }, [selectedProject]);

  const provider = useSelectedProvider();

  const fetchFileDiff = useCallback(
    async (filePath: string, signal?: AbortSignal) => {
      if (!selectedProject) {
        return;
      }

      // Git endpoints receive the DB projectId via the `project` query param.
      const projectId = selectedProject.projectId;

      try {
        const response = await api.git.diff(projectId, filePath, { signal });
        const data = await readJson<GitDiffResponse>(response, signal);

        if (
          signal?.aborted ||
          selectedProjectIdRef.current !== projectId
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

    // `project` query param carries the DB projectId everywhere now.
    const projectId = selectedProject.projectId;

    setIsLoading(true);
    try {
      const response = await api.git.status(projectId, { signal });
      const data = await readJson<GitStatusResponse>(response, signal);

      if (
        signal?.aborted ||
        selectedProjectIdRef.current !== projectId
      ) {
        return;
      }

      if (data.error) {
        // A missing repository is an expected state, not an error.
        if (!data.notGitRepository) {
          console.error('Git status error:', data.error);
        }
        setGitStatus({
          error: data.error,
          details: data.details,
          notGitRepository: data.notGitRepository,
        });
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
        selectedProjectIdRef.current !== projectId
      ) {
        return;
      }

      console.error('Error fetching git status:', error);
      setGitStatus({ error: 'Git operation failed', details: String(error) });
      setCurrentBranch('');
    } finally {
      setIsLoading(false);
    }
  }, [fetchFileDiff, selectedProject]);

  const fetchBranches = useCallback(async () => {
    if (!selectedProject) {
      return;
    }

    try {
      const response = await api.git.branches(selectedProject.projectId);
      const data = await readJson<GitBranchesResponse>(response);

      if (!data.error && data.branches) {
        setBranches(data.branches);
        setLocalBranches(data.localBranches ?? data.branches);
        setRemoteBranches(data.remoteBranches ?? []);
        return;
      }

      setBranches([]);
      setLocalBranches([]);
      setRemoteBranches([]);
    } catch (error) {
      console.error('Error fetching branches:', error);
      setBranches([]);
      setLocalBranches([]);
      setRemoteBranches([]);
    }
  }, [selectedProject]);

  const fetchRemoteStatus = useCallback(async () => {
    if (!selectedProject) {
      return;
    }

    try {
      const response = await api.git.remoteStatus(selectedProject.projectId);
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
        const response = await api.git.checkout(selectedProject.projectId, branchName);

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
        const response = await api.git.createBranch(selectedProject.projectId, trimmedBranchName);

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

  const deleteBranch = useCallback(
    async (branchName: string, force = false) => {
      if (!selectedProject) return false;

      try {
        const response = await api.git.deleteBranch(selectedProject.projectId, branchName, force);

        const data = await readJson<GitOperationResponse>(response);
        if (!data.success) {
          setOperationError(data.error ?? 'Delete branch failed');
          return false;
        }

        void fetchBranches();
        return true;
      } catch (error) {
        setOperationError(error instanceof Error ? error.message : 'Delete branch failed');
        return false;
      }
    },
    [fetchBranches, selectedProject],
  );

  const handleFetch = useCallback(async () => {
    if (!selectedProject) {
      return;
    }

    setIsFetching(true);
    try {
      const response = await api.git.fetch(selectedProject.projectId);

      const data = await readJson<GitOperationResponse>(response);
      if (data.success) {
        void fetchGitStatus();
        void fetchRemoteStatus();
        void fetchBranches();
        return;
      }

      setOperationError(data.error ?? 'Fetch failed');
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : 'Fetch failed');
    } finally {
      setIsFetching(false);
    }
  }, [fetchBranches, fetchGitStatus, fetchRemoteStatus, selectedProject]);

  const handlePull = useCallback(async () => {
    if (!selectedProject) {
      return;
    }

    setIsPulling(true);
    try {
      const response = await api.git.pull(selectedProject.projectId);

      const data = await readJson<GitOperationResponse>(response);
      if (data.success) {
        void fetchGitStatus();
        void fetchRemoteStatus();
        return;
      }

      setOperationError(data.error ?? 'Pull failed');
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : 'Pull failed');
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
      const response = await api.git.push(selectedProject.projectId);

      const data = await readJson<GitOperationResponse>(response);
      if (data.success) {
        void fetchGitStatus();
        void fetchRemoteStatus();
        return;
      }

      setOperationError(data.error ?? 'Push failed');
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : 'Push failed');
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
      const response = await api.git.publish(selectedProject.projectId, currentBranch);

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
        const response = await api.git.discard(selectedProject.projectId, filePath);

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
        const response = await api.git.deleteUntracked(selectedProject.projectId, filePath);

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

  const stageFiles = useCallback(
    async (files: string[]) => {
      if (!selectedProject || files.length === 0) {
        return false;
      }

      try {
        const response = await api.git.stage(selectedProject.projectId, files);

        const data = await readJson<GitOperationResponse>(response);
        if (!data.success) {
          setOperationError(data.error ?? 'Stage failed');
          return false;
        }

        // Refresh so the Staged section re-syncs from the real index.
        await fetchGitStatus();
        return true;
      } catch (error) {
        setOperationError(error instanceof Error ? error.message : 'Stage failed');
        return false;
      }
    },
    [fetchGitStatus, selectedProject],
  );

  const unstageFiles = useCallback(
    async (files: string[]) => {
      if (!selectedProject || files.length === 0) {
        return false;
      }

      try {
        const response = await api.git.unstage(selectedProject.projectId, files);

        const data = await readJson<GitOperationResponse>(response);
        if (!data.success) {
          setOperationError(data.error ?? 'Unstage failed');
          return false;
        }

        await fetchGitStatus();
        return true;
      } catch (error) {
        setOperationError(error instanceof Error ? error.message : 'Unstage failed');
        return false;
      }
    },
    [fetchGitStatus, selectedProject],
  );

  const fetchRecentCommits = useCallback(async () => {
    if (!selectedProject) {
      return;
    }

    const projectId = selectedProject.projectId;

    setIsLoadingCommits(true);
    try {
      const response = await api.git.commits(projectId, { limit: RECENT_COMMITS_LIMIT });
      const data = await readJson<GitCommitsResponse>(response);

      if (selectedProjectIdRef.current !== projectId) {
        return;
      }

      if (!data.error && data.commits) {
        setRecentCommits(data.commits);
      }
    } catch (error) {
      console.error('Error fetching commits:', error);
    } finally {
      if (selectedProjectIdRef.current === projectId) {
        setIsLoadingCommits(false);
        setHasLoadedCommits(true);
      }
    }
  }, [selectedProject]);

  const fetchCommitDiff = useCallback(
    async (commitHash: string) => {
      if (!selectedProject) {
        return;
      }

      try {
        const response = await api.git.commitDiff(selectedProject.projectId, commitHash);
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
        const response = await api.git.generateCommitMessage(
          selectedProject.projectId,
          files,
          provider,
        );

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
        const response = await api.git.commit(selectedProject.projectId, message, files);

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
      throw new Error('No project selected');
    }

    setIsCreatingInitialCommit(true);
    try {
      const response = await api.git.initialCommit(selectedProject.projectId);

      const data = await readJson<GitOperationResponse>(response);
      if (data.success) {
        void fetchGitStatus();
        void fetchRemoteStatus();
        return true;
      }

      throw new Error(data.error || 'Failed to create initial commit');
    } catch (error) {
      console.error('Error creating initial commit:', error);
      throw error;
    } finally {
      setIsCreatingInitialCommit(false);
    }
  }, [fetchGitStatus, fetchRemoteStatus, selectedProject]);

  const initRepository = useCallback(async () => {
    if (!selectedProject) {
      return false;
    }
    const projectId = selectedProject.projectId;

    setIsInitializingRepository(true);
    try {
      const response = await api.git.init(projectId);

      const data = await readJson<GitOperationResponse>(response);
      if (selectedProjectIdRef.current !== projectId) {
        return false;
      }
      if (!data.success) {
        setOperationError(data.error ?? 'Failed to initialize repository');
        return false;
      }

      void fetchGitStatus();
      void fetchBranches();
      void fetchRemoteStatus();
      return true;
    } catch (error) {
      if (selectedProjectIdRef.current === projectId) {
        setOperationError(error instanceof Error ? error.message : 'Failed to initialize repository');
      }
      return false;
    } finally {
      setIsInitializingRepository(false);
    }
  }, [fetchBranches, fetchGitStatus, fetchRemoteStatus, selectedProject]);

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
        const response = await api.git.fileWithDiff(selectedProject.projectId, filePath);
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
    setLocalBranches([]);
    setRemoteBranches([]);
    setGitStatus(null);
    setRemoteStatus(null);
    setGitDiff({});
    setRecentCommits([]);
    setCommitDiffs({});
    setIsLoading(false);
    setIsLoadingCommits(false);
    setHasLoadedCommits(false);
    setOperationError(null);

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
    // History is "loading" until the first commits response for this project
    // lands, so an empty list never renders before the data exists.
    isLoadingCommits: isLoadingCommits || !hasLoadedCommits,
    currentBranch,
    branches,
    localBranches,
    remoteBranches,
    recentCommits,
    commitDiffs,
    remoteStatus,
    isCreatingBranch,
    isFetching,
    isPulling,
    isPushing,
    isPublishing,
    isCreatingInitialCommit,
    isInitializingRepository,
    operationError,
    clearOperationError,
    refreshAll,
    switchBranch,
    createBranch,
    deleteBranch,
    handleFetch,
    handlePull,
    handlePush,
    handlePublish,
    discardChanges,
    deleteUntrackedFile,
    stageFiles,
    unstageFiles,
    fetchCommitDiff,
    generateCommitMessage,
    commitChanges,
    createInitialCommit,
    initRepository,
    openFile,
  };
}
