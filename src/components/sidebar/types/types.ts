import type { LoadingProgress, Project, ProjectSession, SessionProvider } from '../../../types/app';

export type ProjectSortOrder = 'name' | 'date';

export type SessionWithProvider = ProjectSession & {
  __provider: SessionProvider;
};

export type AdditionalSessionsByProject = Record<string, ProjectSession[]>;
export type LoadingSessionsByProject = Record<string, boolean>;

export type DeleteProjectConfirmation = {
  project: Project;
  sessionCount: number;
};

export type SessionDeleteConfirmation = {
  projectName: string;
  sessionId: string;
  sessionTitle: string;
  provider: SessionProvider;
};

export type SidebarProps = {
  projects: Project[];
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  onProjectSelect: (project: Project) => void;
  onSessionSelect: (session: ProjectSession) => void;
  onNewSession: (project: Project) => void;
  onSessionDelete?: (sessionId: string) => void;
  onProjectDelete?: (projectName: string) => void;
  isLoading: boolean;
  loadingProgress: LoadingProgress | null;
  onRefresh: () => Promise<void> | void;
  onShowSettings: () => void;
  showSettings: boolean;
  settingsInitialTab: string;
  onCloseSettings: () => void;
  isMobile: boolean;
};

export type SessionViewModel = {
  isCursorSession: boolean;
  isCodexSession: boolean;
  isGeminiSession: boolean;
  isActive: boolean;
  sessionName: string;
  sessionTime: string;
  messageCount: number;
};

export type MCPServerStatus = {
  hasMCPServer?: boolean;
  isConfigured?: boolean;
} | null;

export type SettingsProject = Pick<Project, 'name' | 'displayName' | 'fullPath' | 'path'>;

export type RepoGroup = {
  /** Discriminant so the sidebar can distinguish groups from standalone projects. */
  __type: 'repo-group';
  /** Absolute path to the main repository root. */
  repoRoot: string;
  /** Human-readable name derived from the main worktree's displayName. */
  displayName: string;
  /** Child projects (main worktree first, then linked worktrees sorted by branch). */
  projects: Project[];
};
