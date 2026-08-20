import type { Project, TaskMasterContextError, TaskMasterMcpStatus, TaskMasterProject, TaskMasterProjectInfo, TaskMasterProjectInput, TaskMasterTask } from '@/shared/types';




export type TaskMasterWebSocketMessage = {
  type?: string;
  // Post-migration TaskMaster broadcasts identify projects by `projectId`.
  projectId?: string;
  [key: string]: unknown;
};

export type TaskMasterContextValue = {
  projects: TaskMasterProject[];
  currentProject: TaskMasterProject | null;
  projectTaskMaster: TaskMasterProjectInfo | null;
  mcpServerStatus: TaskMasterMcpStatus;
  tasks: TaskMasterTask[];
  nextTask: TaskMasterTask | null;
  isLoading: boolean;
  isLoadingTasks: boolean;
  isLoadingMCP: boolean;
  error: TaskMasterContextError | null;
  refreshProjects: () => Promise<void>;
  setCurrentProject: (project: TaskMasterProjectInput) => void;
  refreshTasks: () => Promise<void>;
  refreshMCPStatus: () => Promise<void>;
  clearError: () => void;
};





