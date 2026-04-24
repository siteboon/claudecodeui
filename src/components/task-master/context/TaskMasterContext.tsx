import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { api } from '../../../utils/api';
import { useAuth } from '../../auth/context/AuthContext';
import { useWebSocket } from '../../../contexts/WebSocketContext';
import type {
  TaskMasterContextError,
  TaskMasterContextValue,
  TaskMasterMcpStatus,
  TaskMasterProject,
  TaskMasterProjectInfo,
  TaskMasterProjectInput,
  TaskMasterTask,
  TaskMasterWebSocketMessage,
} from '../types';

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

export function TaskMasterProvider({ children }: { children: React.ReactNode }) {
  const { latestMessage } = useWebSocket();
  const { user, token, isLoading: isAuthLoading } = useAuth();

  const [projects, setProjects] = useState<TaskMasterProject[]>([]);
  const [currentProject, setCurrentProjectState] = useState<TaskMasterProject | null>(null);
  const [projectTaskMaster, setProjectTaskMaster] = useState<TaskMasterProjectInfo | null>(null);
  const [mcpServerStatus, setMcpServerStatus] = useState<TaskMasterMcpStatus>(null);

  const [tasks, setTasks] = useState<TaskMasterTask[]>([]);
  const [nextTask, setNextTask] = useState<TaskMasterTask | null>(null);

  const [isLoading, setIsLoading] = useState(false);
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

    setProjects((previousProjects) =>
      previousProjects.map((project) => {
        if (project.projectId !== projectId) {
          return project;
        }

        return enrichProject({
          ...project,
          taskmaster: taskMasterInfo ?? undefined,
        });
      }),
    );

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

  const refreshProjects = useCallback(async () => {
    if (!user || !token) {
      setProjects([]);
      setCurrentProjectState(null);
      setProjectTaskMaster(null);
      setTasks([]);
      setNextTask(null);
      return;
    }

    try {
      setIsLoading(true);
      clearError();

      const response = await api.get('/projects');
      if (!response.ok) {
        throw new Error(`Failed to fetch projects: ${response.status}`);
      }

      const data = (await response.json()) as unknown;
      const loadedProjects = Array.isArray(data) ? (data as TaskMasterProject[]) : [];
      const enrichedProjects = loadedProjects.map((project) => enrichProject(project));

      setProjects((previousProjects) => {
        // Cache is keyed by `projectId` (DB primary key) post-migration.
        const taskMasterByProjectId = new Map(
          previousProjects
            .filter((project) => Boolean(project.taskmaster))
            .map((project) => [project.projectId, project.taskmaster]),
        );

        return enrichedProjects.map((project) => {
          const cachedTaskMasterInfo = taskMasterByProjectId.get(project.projectId);
          if (!cachedTaskMasterInfo) {
            return project;
          }

          return enrichProject({
            ...project,
            taskmaster: cachedTaskMasterInfo,
          });
        });
      });

      const currentProjectId = currentProjectIdRef.current;
      if (!currentProjectId) {
        return;
      }

      const matchingProject = enrichedProjects.find((project) => project.projectId === currentProjectId) ?? null;

      if (!matchingProject) {
        taskMasterRequestSeqRef.current += 1;
        setCurrentProjectState(null);
        setProjectTaskMaster(null);
        setTasks([]);
        setNextTask(null);
        return;
      }

      const cachedTaskMasterInfo = matchingProject.taskmaster ?? projectTaskMasterRef.current ?? null;
      setCurrentProjectState(
        cachedTaskMasterInfo
          ? enrichProject({
              ...matchingProject,
              taskmaster: cachedTaskMasterInfo,
            })
          : matchingProject,
      );
      setProjectTaskMaster(cachedTaskMasterInfo);

      void refreshCurrentProjectTaskMaster(currentProjectId);
    } catch (caughtError) {
      handleError('load projects', caughtError);
    } finally {
      setIsLoading(false);
    }
  }, [clearError, handleError, refreshCurrentProjectTaskMaster, token, user]);

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

      const response = await api.get(`/taskmaster/tasks/${encodeURIComponent(projectId)}`);
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

      const response = await api.get('/mcp-utils/taskmaster-server');
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
      void refreshProjects();
      void refreshMCPStatus();
    }
  }, [isAuthLoading, refreshMCPStatus, refreshProjects, token, user]);

  useEffect(() => {
    if (currentProject?.projectId && user && token) {
      void refreshTasks();
    }
  }, [currentProject?.projectId, refreshTasks, token, user]);

  useEffect(() => {
    const message = latestMessage as TaskMasterWebSocketMessage | null;
    if (!isTaskMasterMessage(message)) {
      return;
    }

    // Broadcasts now identify projects by `projectId` (see taskmaster-websocket.js).
    if (message.type === 'taskmaster-project-updated' && message.projectId) {
      if (message.projectId === currentProjectIdRef.current) {
        void refreshCurrentProjectTaskMaster(message.projectId);
      }
      void refreshProjects();
      return;
    }

    if (message.type === 'taskmaster-tasks-updated' && message.projectId === currentProject?.projectId) {
      void refreshTasks();
      return;
    }

    if (message.type === 'taskmaster-mcp-status-changed') {
      void refreshMCPStatus();
    }
  }, [currentProject?.projectId, latestMessage, refreshCurrentProjectTaskMaster, refreshMCPStatus, refreshProjects, refreshTasks]);

  const contextValue = useMemo<TaskMasterContextValue>(
    () => ({
      projects,
      currentProject,
      projectTaskMaster,
      mcpServerStatus,
      tasks,
      nextTask,
      isLoading,
      isLoadingTasks,
      isLoadingMCP,
      error,
      refreshProjects,
      setCurrentProject,
      refreshTasks,
      refreshMCPStatus,
      clearError,
    }),
    [
      clearError,
      currentProject,
      error,
      isLoading,
      isLoadingMCP,
      isLoadingTasks,
      mcpServerStatus,
      nextTask,
      projectTaskMaster,
      projects,
      refreshMCPStatus,
      refreshProjects,
      refreshTasks,
      setCurrentProject,
      tasks,
    ],
  );

  return <TaskMasterContext.Provider value={contextValue}>{children}</TaskMasterContext.Provider>;
}

export default TaskMasterContext;
