import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { api } from '@/shared/api';
import { useAuth } from '@/modules/auth';
import { useWebSocket } from '@/shared/context/WebSocketContext';
import type { Project, ServerEvent, TaskMasterProject, TaskMasterProjectInfo, TaskMasterTask } from '@/shared/types';

/** What may be handed to setCurrentProject: a TaskMaster-enriched project, a plain project, or null to clear the selection. */
type TaskMasterProjectInput = TaskMasterProject | Project | null;

/** A failed TaskMaster operation recorded for display, naming the operation that failed and when the failure happened. */
type TaskMasterContextError = {
  message: string;
  context: string;
  timestamp: string;
};

/** Detailed status of the TaskMaster MCP server, including its configuration, API-key availability and the reason it is unusable, or null while the status is unknown. */
type TaskMasterMcpStatus = {
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

type TaskMasterWebSocketMessage = {
  type?: string;
  // Post-migration TaskMaster broadcasts identify projects by `projectId`.
  projectId?: string;
  [key: string]: unknown;
};

type TaskMasterContextValue = {
  currentProject: TaskMasterProject | null;
  projectTaskMaster: TaskMasterProjectInfo | null;
  mcpServerStatus: TaskMasterMcpStatus;
  tasks: TaskMasterTask[];
  nextTask: TaskMasterTask | null;
  isLoadingTasks: boolean;
  isLoadingMCP: boolean;
  error: TaskMasterContextError | null;
  setCurrentProject: (project: TaskMasterProjectInput) => void;
  refreshTasks: () => Promise<void>;
  refreshMCPStatus: () => Promise<void>;
  clearError: () => void;
};

const TaskMasterContext = createContext<TaskMasterContextValue | null>(null);

function createTaskMasterError(context: string, error: unknown): TaskMasterContextError {
  const message = error instanceof Error ? error.message : `Failed to ${context}`;
  return {
    message,
    context,
    timestamp: new Date().toISOString(),
  };
}

function enrichProject(project: TaskMasterProject): TaskMasterProject {
  return {
    ...project,
    taskMasterConfigured: project.taskmaster?.hasTaskmaster ?? false,
    taskMasterStatus: project.taskmaster?.status ?? 'not-configured',
    taskCount: Number(project.taskmaster?.metadata?.taskCount ?? 0),
    completedCount: Number(project.taskmaster?.metadata?.completed ?? 0),
  };
}

function getNextTask(tasks: TaskMasterTask[]): TaskMasterTask | null {
  return tasks.find((task) => task.status === 'pending' || task.status === 'in-progress') ?? null;
}

function isTaskMasterMessage(
  message: TaskMasterWebSocketMessage | null,
): message is TaskMasterWebSocketMessage & { type: string } {
  if (!message?.type) {
    return false;
  }

  return message.type.startsWith('taskmaster-');
}

export function useTaskMaster() {
  const context = useContext(TaskMasterContext);
  if (!context) {
    throw new Error('useTaskMaster must be used within a TaskMasterProvider');
  }
  return context;
}

/** Mounted by App.tsx; supplies the TaskMaster project and task state that the sidebar module and this module's own components read through useTaskMaster. */
export function TaskMasterProvider({ children }: { children: React.ReactNode }) {
  const { subscribe } = useWebSocket();
  const { user, token, isLoading: isAuthLoading } = useAuth();

  const [currentProject, setCurrentProjectState] = useState<TaskMasterProject | null>(null);
  const [projectTaskMaster, setProjectTaskMaster] = useState<TaskMasterProjectInfo | null>(null);
  const [mcpServerStatus, setMcpServerStatus] = useState<TaskMasterMcpStatus>(null);

  const [tasks, setTasks] = useState<TaskMasterTask[]>([]);
  const [nextTask, setNextTask] = useState<TaskMasterTask | null>(null);

  const [isLoadingTasks, setIsLoadingTasks] = useState(false);
  const [isLoadingMCP, setIsLoadingMCP] = useState(false);
  const [error, setError] = useState<TaskMasterContextError | null>(null);

  // Track the active project via DB `projectId`; everything downstream uses
  // the same identifier post-migration.
  const currentProjectIdRef = useRef<string | null>(null);
  const projectTaskMasterRef = useRef<TaskMasterProjectInfo | null>(null);
  const taskMasterRequestSeqRef = useRef(0);

  useEffect(() => {
    currentProjectIdRef.current = currentProject?.projectId ?? null;
  }, [currentProject?.projectId]);

  useEffect(() => {
    projectTaskMasterRef.current = projectTaskMaster;
  }, [projectTaskMaster]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const handleError = useCallback((context: string, caughtError: unknown) => {
    console.error(`TaskMaster ${context} error:`, caughtError);
    setError(createTaskMasterError(context, caughtError));
  }, []);

  // Looks up projects by DB `projectId`; the legacy folder-derived `name`
  // field has been removed from Project post-migration.
  const applyTaskMasterInfo = useCallback((projectId: string, taskMasterInfo: TaskMasterProjectInfo | null) => {
    setProjectTaskMaster(taskMasterInfo);

    setCurrentProjectState((previousProject) => {
      if (!previousProject || previousProject.projectId !== projectId) {
        return previousProject;
      }

      return enrichProject({
        ...previousProject,
        taskmaster: taskMasterInfo ?? undefined,
      });
    });
  }, []);

  const refreshCurrentProjectTaskMaster = useCallback(
    async (projectId: string) => {
      if (!projectId || !user || !token) {
        return;
      }

      const requestSequence = ++taskMasterRequestSeqRef.current;

      try {
        const response = await api.projectTaskmaster(projectId);
        if (!response.ok) {
          throw new Error(`Failed to fetch TaskMaster details: ${response.status}`);
        }

        const data = (await response.json()) as { taskmaster?: TaskMasterProjectInfo };
        const resolvedTaskMasterInfo = data.taskmaster ?? null;

        if (
          requestSequence !== taskMasterRequestSeqRef.current
          || currentProjectIdRef.current !== projectId
        ) {
          return;
        }

        applyTaskMasterInfo(projectId, resolvedTaskMasterInfo);
      } catch (caughtError) {
        if (
          requestSequence !== taskMasterRequestSeqRef.current
          || currentProjectIdRef.current !== projectId
        ) {
          return;
        }

        handleError('load selected project TaskMaster info', caughtError);
      }
    },
    [applyTaskMasterInfo, handleError, token, user],
  );

  const setCurrentProject = useCallback(
    (project: TaskMasterProjectInput) => {
      const normalizedProject = project ? enrichProject(project as TaskMasterProject) : null;
      setCurrentProjectState(normalizedProject);
      setProjectTaskMaster(normalizedProject?.taskmaster ?? null);

      // Project-scoped task data is reset immediately to avoid stale task rendering.
      setTasks([]);
      setNextTask(null);

      // `projectId` is the DB primary key used for every TaskMaster API call.
      if (!normalizedProject?.projectId) {
        taskMasterRequestSeqRef.current += 1;
        return;
      }

      void refreshCurrentProjectTaskMaster(normalizedProject.projectId);
    },
    [refreshCurrentProjectTaskMaster],
  );

  /**
   * Re-reads TaskMaster details for whichever project is selected.
   *
   * This used to fetch the whole `/api/projects` list — a second copy of the
   * request the workspace already makes on boot, with its own taskmaster merge
   * — even though the only thing downstream reads is `currentProject`. The
   * per-project endpoint answers exactly that question, which also means it is
   * now the same call setCurrentProject and the websocket handler already make,
   * so the only caller left is the sign-in effect below.
   */
  const refreshSelectedProjectTaskMaster = useCallback(async () => {
    const currentProjectId = currentProjectIdRef.current;
    if (!currentProjectId) {
      return;
    }

    await refreshCurrentProjectTaskMaster(currentProjectId);
  }, [refreshCurrentProjectTaskMaster]);

  const refreshTasks = useCallback(async () => {
    // TaskMaster tasks endpoint now lives under /api/taskmaster/tasks/:projectId.
    const projectId = currentProject?.projectId;

    if (!projectId || !user || !token) {
      setTasks([]);
      setNextTask(null);
      return;
    }

    try {
      setIsLoadingTasks(true);
      clearError();

      const response = await api.taskmaster.tasks(projectId);
      if (!response.ok) {
        const errorPayload = (await response.json()) as { message?: string };
        throw new Error(errorPayload.message ?? 'Failed to load tasks');
      }

      const data = (await response.json()) as { tasks?: TaskMasterTask[] };
      const loadedTasks = Array.isArray(data.tasks) ? data.tasks : [];

      setTasks(loadedTasks);
      setNextTask(getNextTask(loadedTasks));
    } catch (caughtError) {
      handleError('load tasks', caughtError);
      setTasks([]);
      setNextTask(null);
    } finally {
      setIsLoadingTasks(false);
    }
  }, [clearError, currentProject?.projectId, handleError, token, user]);

  const refreshMCPStatus = useCallback(async () => {
    if (!user || !token) {
      setMcpServerStatus(null);
      return;
    }

    try {
      setIsLoadingMCP(true);
      clearError();

      const response = await api.taskmaster.mcpStatus();
      if (!response.ok) {
        throw new Error(`Failed to load MCP status: ${response.status}`);
      }

      const status = (await response.json()) as TaskMasterMcpStatus;
      setMcpServerStatus(status);
    } catch (caughtError) {
      handleError('check MCP server status', caughtError);
      setMcpServerStatus(null);
    } finally {
      setIsLoadingMCP(false);
    }
  }, [clearError, handleError, token, user]);

  useEffect(() => {
    if (!isAuthLoading && user && token) {
      void refreshSelectedProjectTaskMaster();
      void refreshMCPStatus();
    }
  }, [isAuthLoading, refreshMCPStatus, refreshSelectedProjectTaskMaster, token, user]);

  useEffect(() => {
    if (currentProject?.projectId && user && token) {
      void refreshTasks();
    }
  }, [currentProject?.projectId, refreshTasks, token, user]);

  useEffect(() => {
    const handleEvent = (event: ServerEvent) => {
      const message = event as TaskMasterWebSocketMessage;
      if (!isTaskMasterMessage(message)) {
        return;
      }

      // Broadcasts identify projects by their DB `projectId`.
      if (message.type === 'taskmaster-project-updated' && message.projectId) {
        // Only the selected project has anything to re-read. The second call
        // here used to be refreshProjects(), which after e872a34 is this exact
        // per-project request — so a broadcast for the selected project fired
        // two identical fetches, and a broadcast for any other project refetched
        // the selected one for news that said nothing about it.
        if (message.projectId === currentProjectIdRef.current) {
          void refreshCurrentProjectTaskMaster(message.projectId);
        }
        return;
      }

      if (
        message.type === 'taskmaster-tasks-updated'
        && message.projectId === currentProjectIdRef.current
      ) {
        void refreshTasks();
        return;
      }
    };

    return subscribe(handleEvent);
  }, [refreshCurrentProjectTaskMaster, refreshTasks, subscribe]);

  const contextValue = useMemo<TaskMasterContextValue>(
    () => ({
      currentProject,
      projectTaskMaster,
      mcpServerStatus,
      tasks,
      nextTask,
      isLoadingTasks,
      isLoadingMCP,
      error,
      setCurrentProject,
      refreshTasks,
      refreshMCPStatus,
      clearError,
    }),
    [
      clearError,
      currentProject,
      error,
      isLoadingMCP,
      isLoadingTasks,
      mcpServerStatus,
      nextTask,
      projectTaskMaster,
      refreshMCPStatus,
      refreshTasks,
      setCurrentProject,
      tasks,
    ],
  );

  return <TaskMasterContext.Provider value={contextValue}>{children}</TaskMasterContext.Provider>;
}
