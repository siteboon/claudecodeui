import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { api } from '../utils/api';
import { useAuth } from './AuthContext';
import { useWebSocket } from './WebSocketContext';

const TaskMasterContext = createContext({
  projects: [],
  currentProject: null,
  projectTaskMaster: null,
  mcpServerStatus: null,
  tasks: [],
  nextTask: null,
  isLoading: false,
  isLoadingTasks: false,
  isLoadingMCP: false,
  error: null,
  refreshProjects: () => {},
  setCurrentProject: () => {},
  refreshTasks: () => {},
  refreshMCPStatus: () => {},
  clearError: () => {}
});

export const useTaskMaster = () => {
  const context = useContext(TaskMasterContext);
  if (!context) {
    throw new Error('useTaskMaster must be used within a TaskMasterProvider');
  }
  return context;
};

export const TaskMasterProvider = ({ children }) => {
  const { latestMessage } = useWebSocket();
  const { user, token, isLoading: authLoading } = useAuth();
  
  const [projects, setProjects] = useState([]);
  const [currentProject, setCurrentProjectState] = useState(null);
  const [projectTaskMaster, setProjectTaskMaster] = useState(null);
  const [mcpServerStatus, setMCPServerStatus] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [nextTask, setNextTask] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingTasks, setIsLoadingTasks] = useState(false);
  const [isLoadingMCP, setIsLoadingMCP] = useState(false);
  const [error, setError] = useState(null);

  const isLoadingProjectsRef = useRef(false);
  const isLoadingTasksRef = useRef(false);
  const hasLoadedRef = useRef(false);

  const handleError = (error, context) => {
    console.error(`TaskMaster ${context} error:`, error);
    setError({
      message: error.message || `Failed to ${context}`,
      context,
      timestamp: new Date().toISOString()
    });
  };

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const refreshProjects = useCallback(async (force = false) => {
    if (!user || !token) {
      setProjects([]);
      return;
    }

    if (isLoadingProjectsRef.current && !force) {
      return;
    }

    try {
      isLoadingProjectsRef.current = true;
      setIsLoading(true);
      
      const response = await api.get('/projects');
      
      if (!response.ok) {
        throw new Error(`Failed to fetch projects: ${response.status}`);
      }
      
      const projectsData = await response.json();
      
      if (!Array.isArray(projectsData)) {
        console.error('Projects API returned non-array data:', projectsData);
        setProjects([]);
        return;
      }
      
      const enrichedProjects = projectsData.map(project => ({
        ...project,
        taskMasterConfigured: project.taskmaster?.hasTaskmaster || false,
        taskMasterStatus: project.taskmaster?.status || 'not-configured',
        taskCount: project.taskmaster?.metadata?.taskCount || 0,
        completedCount: project.taskmaster?.metadata?.completed || 0
      }));
      
      setProjects(enrichedProjects);
      
      if (currentProject) {
        const updatedCurrent = enrichedProjects.find(p => p.name === currentProject.name);
        if (updatedCurrent) {
          setCurrentProjectState(updatedCurrent);
          setProjectTaskMaster(updatedCurrent.taskmaster);
        }
      }
    } catch (err) {
      handleError(err, 'load projects');
    } finally {
      setIsLoading(false);
      isLoadingProjectsRef.current = false;
    }
  }, [user, token, currentProject]);

  const setCurrentProject = useCallback((project) => {
    setCurrentProjectState(project);
    setTasks([]);
    setNextTask(null);
    setProjectTaskMaster(project?.taskmaster || null);
  }, []);

  const refreshMCPStatus = useCallback(async () => {
    if (!user || !token) {
      setMCPServerStatus(null);
      return;
    }

    try {
      setIsLoadingMCP(true);
      const mcpStatus = await api.get('/mcp-utils/taskmaster-server');
      setMCPServerStatus(mcpStatus);
    } catch (err) {
      handleError(err, 'check MCP server status');
    } finally {
      setIsLoadingMCP(false);
    }
  }, [user, token]);

  const refreshTasks = useCallback(async (force = false) => {
    if (!currentProject?.name) {
      setTasks([]);
      setNextTask(null);
      return;
    }

    if (!user || !token) {
      setTasks([]);
      setNextTask(null);
      return;
    }

    if (isLoadingTasksRef.current && !force) {
      return;
    }

    try {
      isLoadingTasksRef.current = true;
      setIsLoadingTasks(true);
      
      const response = await api.get(`/taskmaster/tasks/${encodeURIComponent(currentProject.name)}`);
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to load tasks');
      }
      
      const data = await response.json();
      
      setTasks(data.tasks || []);
      
      const nextTask = data.tasks?.find(task => 
        task.status === 'pending' || task.status === 'in-progress'
      ) || null;
      setNextTask(nextTask);
      
    } catch (err) {
      console.error('Error loading tasks:', err);
      handleError(err, 'load tasks');
      setTasks([]);
      setNextTask(null);
    } finally {
      setIsLoadingTasks(false);
      isLoadingTasksRef.current = false;
    }
  }, [currentProject?.name, user, token]);

  useEffect(() => {
    if (!authLoading && user && token && !hasLoadedRef.current) {
      hasLoadedRef.current = true;
      refreshProjects();
      refreshMCPStatus();
    } else if (!user || !token) {
      hasLoadedRef.current = false;
      setProjects([]);
    }
  }, [authLoading, user, token, refreshProjects, refreshMCPStatus]);

  useEffect(() => {
    if (user && token) {
      clearError();
    }
  }, [user, token, clearError]);

  useEffect(() => {
    if (currentProject?.name && user && token) {
      refreshTasks();
    }
  }, [currentProject?.name, user, token, refreshTasks]);

  useEffect(() => {
    if (!latestMessage) return;

    switch (latestMessage.type) {
      case 'taskmaster-project-updated':
        if (latestMessage.projectName) {
          refreshProjects(true);
        }
        break;
        
      case 'taskmaster-tasks-updated':
        if (latestMessage.projectName === currentProject?.name) {
          refreshTasks(true);
        }
        break;
        
      case 'taskmaster-mcp-status-changed':
        refreshMCPStatus();
        break;
        
      default:
        break;
    }
  }, [latestMessage, refreshProjects, refreshTasks, refreshMCPStatus, currentProject?.name]);

  const contextValue = {
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
    clearError
  };

  return (
    <TaskMasterContext.Provider value={contextValue}>
      {children}
    </TaskMasterContext.Provider>
  );
};

export default TaskMasterContext;
