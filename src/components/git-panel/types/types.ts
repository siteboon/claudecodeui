import type { Project } from '../../../types/app';

export type GitPanelView = 'changes' | 'history';
export type FileStatusCode = 'M' | 'A' | 'D' | 'U';
export type GitStatusFileGroup = 'modified' | 'added' | 'deleted' | 'untracked';
export type ConfirmActionType = 'discard' | 'delete' | 'commit' | 'pull' | 'push' | 'publish';

export type FileDiffInfo = {
  old_string: string;
  new_string: string;
};

export type FileOpenHandler = (filePath: string, diffInfo?: FileDiffInfo) => void;

export type GitPanelProps = {
  selectedProject: Project | null;
  isMobile?: boolean;
  onFileOpen?: FileOpenHandler;
};

export type GitStatusResponse = {
  branch?: string;
  hasCommits?: boolean;
  modified?: string[];
  added?: string[];
  deleted?: string[];
  untracked?: string[];
  error?: string;
  details?: string;
};

export type GitRemoteStatus = {
  hasRemote?: boolean;
  hasUpstream?: boolean;
  branch?: string;
  remoteBranch?: string;
  remoteName?: string | null;
  ahead?: number;
  behind?: number;
  isUpToDate?: boolean;
  message?: string;
  error?: string;
};

export type GitCommitSummary = {
  hash: string;
  author: string;
  email?: string;
  date: string;
  message: string;
  stats?: string;
};

export type GitDiffMap = Record<string, string>;

export type GitStatusGroupEntry = {
  key: GitStatusFileGroup;
  status: FileStatusCode;
};

export type ConfirmationRequest = {
  type: ConfirmActionType;
  message: string;
  onConfirm: () => Promise<void> | void;
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
  currentBranch: string;
  branches: string[];
  recentCommits: GitCommitSummary[];
  commitDiffs: GitDiffMap;
  remoteStatus: GitRemoteStatus | null;
  isCreatingBranch: boolean;
  isFetching: boolean;
  isPulling: boolean;
  isPushing: boolean;
  isPublishing: boolean;
  isCreatingInitialCommit: boolean;
  refreshAll: () => void;
  switchBranch: (branchName: string) => Promise<boolean>;
  createBranch: (branchName: string) => Promise<boolean>;
  handleFetch: () => Promise<void>;
  handlePull: () => Promise<void>;
  handlePush: () => Promise<void>;
  handlePublish: () => Promise<void>;
  discardChanges: (filePath: string) => Promise<void>;
  deleteUntrackedFile: (filePath: string) => Promise<void>;
  fetchCommitDiff: (commitHash: string) => Promise<void>;
  generateCommitMessage: (files: string[]) => Promise<string | null>;
  commitChanges: (message: string, files: string[]) => Promise<boolean>;
  createInitialCommit: () => Promise<boolean>;
  openFile: (filePath: string) => Promise<void>;
};

export type GitApiErrorResponse = {
  error?: string;
  details?: string;
};

export type GitDiffResponse = GitApiErrorResponse & {
  diff?: string;
};

export type GitBranchesResponse = GitApiErrorResponse & {
  branches?: string[];
};

export type GitCommitsResponse = GitApiErrorResponse & {
  commits?: GitCommitSummary[];
};

export type GitOperationResponse = GitApiErrorResponse & {
  success?: boolean;
  output?: string;
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
