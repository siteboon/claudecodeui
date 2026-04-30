import type { LoadingProgress, Project, ProjectSession, LLMProvider } from '../../../types/app';

export type ProjectSortOrder = 'name' | 'date';

export type SessionWithProvider = ProjectSession & {
  __provider: LLMProvider;
};

export type DeleteProjectConfirmation = {
  project: Project;
  sessionCount: number;
};

// Delete confirmation payload used by sidebar UX. `projectId`/`provider` are
// kept for wiring compatibility, while API deletion now keys only by sessionId.
export type SessionDeleteConfirmation = {
  projectId: string;
  sessionId: string;
  sessionTitle: string;
  provider: LLMProvider;
};

export type SidebarProps = {
  projects: Project[];
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  onProjectSelect: (project: Project) => void;
  onSessionSelect: (session: ProjectSession) => void;
  onNewSession: (project: Project) => void;
  onSessionDelete?: (sessionId: string) => void;
  onLoadMoreSessions?: (projectId: string) => Promise<void> | void;
  // `projectId` is the DB identifier; the sidebar hands it back to the parent
  // when the delete flow completes.
  onProjectDelete?: (projectId: string) => void;
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

// Retained as `name` for backwards compatibility with existing settings
// consumers; the value is populated from `projectId` by normalizeProjectForSettings.
export type SettingsProject = {
  name: string;
  displayName: string;
  fullPath: string;
  path?: string;
};
