import type { Project } from '../../types/app';

export type TaskId = string | number;

export type TaskStatus =
  | 'pending'
  | 'in-progress'
  | 'done'
  | 'review'
  | 'blocked'
  | 'deferred'
  | 'cancelled'
  | string;

export type TaskPriority = 'high' | 'medium' | 'low' | string;

export type TaskMasterTask = {
  id: TaskId;
  title: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  details?: string;
  testStrategy?: string;
  parentId?: TaskId;
  dependencies?: TaskId[];
  subtasks?: TaskMasterTask[];
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
};

export type TaskReference = {
  id: TaskId;
  title?: string;
  [key: string]: unknown;
};

export type TaskSelection = TaskMasterTask | TaskReference;

export type PrdFile = {
  name: string;
  content?: string;
  isExisting?: boolean;
  modified?: string;
  created?: string;
  path?: string;
  size?: number;
  [key: string]: unknown;
};

export type TaskMasterProjectInfo = {
  hasTaskmaster?: boolean;
  status?: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
};

export type TaskMasterProject = Project & {
  taskMasterConfigured?: boolean;
  taskMasterStatus?: string;
  taskCount?: number;
  completedCount?: number;
  taskmaster?: TaskMasterProjectInfo;
};

export type TaskMasterProjectInput = TaskMasterProject | Project | null;

export type TaskMasterContextError = {
  message: string;
  context: string;
  timestamp: string;
};

export type TaskMasterMcpStatus = {
  hasMCPServer?: boolean;
  isConfigured?: boolean;
  hasApiKeys?: boolean;
  scope?: string;
  config?: {
    command?: string;
    args?: string[];
    url?: string;
    envVars?: string[];
    type?: string;
  };
  reason?: string;
  [key: string]: unknown;
} | null;

export type TaskMasterWebSocketMessage = {
  type?: string;
  projectName?: string;
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

export type TaskBoardView = 'kanban' | 'list' | 'grid';

export type TaskBoardSortField = 'id' | 'title' | 'status' | 'priority' | 'updated';

export type TaskBoardSortOrder = 'asc' | 'desc';

export type TaskKanbanColumn = {
  id: string;
  title: string;
  status: string;
  color: string;
  headerColor: string;
  tasks: TaskMasterTask[];
};
