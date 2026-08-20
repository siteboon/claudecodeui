import type { FileStatusCode, GitApiErrorResponse, GitCommitSummary, GitDiffMap, GitPanelView, GitRemoteStatus, GitStatusResponse, Project, WorktreeInfo } from '@/shared/types';



export type GitStatusFileGroup = 'modified' | 'added' | 'deleted' | 'untracked';

export type FileDiffInfo = {
  old_string: string;
  new_string: string;
};

export type FileOpenHandler = (filePath: string, diffInfo?: FileDiffInfo) => void;

export type GitPanelProps = {
  selectedProject: Project | null;
  isMobile?: boolean;
  onFileOpen?: FileOpenHandler;
  /** Switches the app to another project — used by the Worktrees view to jump into a worktree. */
  onProjectSelect?: (project: Project) => void;
  /** Silently re-syncs the sidebar project list after worktree projects are created/archived. */
  onProjectsRefresh?: () => void;
};





export type GitStatusGroupEntry = {
  key: GitStatusFileGroup;
  status: FileStatusCode;
};


export type UseGitPanelControllerOptions = {
  selectedProject: Project | null;
  activeView: GitPanelView;
  onFileOpen?: FileOpenHandler;
};

export type GitPanelController = {
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


export type GitDiffResponse = GitApiErrorResponse & {
  diff?: string;
};

export type GitBranchesResponse = GitApiErrorResponse & {
  branches?: string[];
  localBranches?: string[];
  remoteBranches?: string[];
};

export type GitCommitsResponse = GitApiErrorResponse & {
  commits?: GitCommitSummary[];
};


export type GitGenerateMessageResponse = GitApiErrorResponse & {
  message?: string;
};

export type GitFileWithDiffResponse = GitApiErrorResponse & {
  oldContent?: string;
  currentContent?: string;
  isDeleted?: boolean;
  isUntracked?: boolean;
};

// ---------------------------------------------------------------------------
// Worktrees — mirrors the /api/worktrees payloads (server/shared/types.ts)
// ---------------------------------------------------------------------------


export type WorktreeListData = {
  repositoryRoot: string;
  /** Branch checked out in the main worktree — the merge target. */
  baseBranch: string | null;
  worktrees: WorktreeInfo[];
};

/** `/api/worktrees` uses the shared `{ success, data | error }` envelope. */
export type WorktreeApiEnvelope<TData> = {
  success?: boolean;
  data?: TData;
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
};



