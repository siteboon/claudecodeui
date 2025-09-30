import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api } from '../utils/api';
import { useAuth } from './AuthContext';
import { useWebSocketContext } from './WebSocketContext';

const TaskMasterContext = createContext({
  // TaskMaster project state
  projects: [],
  currentProject: null,
  projectTaskMaster: null,
  
  // MCP server state
  mcpServerStatus: null,
  
  // Tasks state
  tasks: [],
  nextTask: null,
  
  // Loading states
  isLoading: false,
  isLoadingTasks: false,
  isLoadingMCP: false,
  
  // Error state
  error: null,
  
  // Actions
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
  // Get WebSocket messages from shared context to avoid duplicate connections
  const { messages } = useWebSocketContext();
  
  // Authentication context
  const { user, token, isLoading: authLoading } = useAuth();
  
  // State
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

  // Helper to handle API errors
  const handleError = (error, context) => {
    console.error(`TaskMaster ${context} error:`, error);
    setError({
      message: error.message || `Failed to ${context}`,
      context,
      timestamp: new Date().toISOString()
    });
  };

  // Clear error state
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // This will be defined after the functions are declared

  // Refresh projects with TaskMaster metadata
  const refreshProjects = useCallback(async () => {
    // Only make API calls if user is authenticated
    if (!user || !token) {
      setProjects([]);
      setCurrentProjectState(null); // This might be the problem!
      return;
    }

    try {
      setIsLoading(true);
      clearError();
      const response = await api.get('/projects');
      
      if (!response.ok) {
        throw new Error(`Failed to fetch projects: ${response.status}`);
      }
      
      const projectsData = await response.json();
      
      // Check if projectsData is an array
      if (!Array.isArray(projectsData)) {
        console.error('Projects API returned non-array data:', projectsData);
        setProjects([]);
        return;
      }
      
      // Filter and enrich projects with TaskMaster data
      const enrichedProjects = projectsData.map(project => ({
        ...project,
        taskMasterConfigured: project.taskmaster?.hasTaskmaster || false,
        taskMasterStatus: project.taskmaster?.status || 'not-configured',
        taskCount: project.taskmaster?.metadata?.taskCount || 0,
        completedCount: project.taskmaster?.metadata?.completed || 0
      }));
      
      setProjects(enrichedProjects);
      
      // If current project is set, update its TaskMaster data
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
    }
  }, [user, token]); // Remove currentProject dependency to avoid infinite loops

  // Set current project and load its TaskMaster details
  const setCurrentProject = useCallback(async (project) => {
    try {
      setCurrentProjectState(project);
      
      // Clear previous project's data immediately when switching projects
      setTasks([]);
      setNextTask(null);
      setProjectTaskMaster(null); // Clear previous TaskMaster data
      
      // Try to fetch fresh TaskMaster detection data for the project
      if (project?.name) {
        try {
          const response = await api.get(`/taskmaster/detect/${encodeURIComponent(project.name)}`);
          if (response.ok) {
            const detectionData = await response.json();
            setProjectTaskMaster(detectionData.taskmaster);
          } else {
            // If individual detection fails, fall back to project data from /api/projects
            console.warn('Individual TaskMaster detection failed, using project data:', response.status);
            setProjectTaskMaster(project.taskmaster || null);
          }
        } catch (detectionError) {
          // If individual detection fails, fall back to project data from /api/projects  
          console.warn('TaskMaster detection error, using project data:', detectionError.message);
          setProjectTaskMaster(project.taskmaster || null);
        }
      } else {
        setProjectTaskMaster(null);
      }
    } catch (err) {
      console.error('Error in setCurrentProject:', err);
      handleError(err, 'set current project');
      // Fall back to project data if available
      setProjectTaskMaster(project?.taskmaster || null);
    }
  }, []);

  // Refresh MCP server status
  const refreshMCPStatus = useCallback(async () => {
    // Only make API calls if user is authenticated
    if (!user || !token) {
      setMCPServerStatus(null);
      return;
    }

    try {
      setIsLoadingMCP(true);
      clearError();
      const mcpStatus = await api.get('/mcp-utils/taskmaster-server');
      setMCPServerStatus(mcpStatus);
    } catch (err) {
      handleError(err, 'check MCP server status');
    } finally {
      setIsLoadingMCP(false);
    }
  }, [user, token]);

  // Refresh tasks for current project - load real TaskMaster data
  const refreshTasks = useCallback(async () => {
    if (!currentProject) {
      setTasks([]);
      setNextTask(null);
      return;
    }

    // Only make API calls if user is authenticated
    if (!user || !token) {
      setTasks([]);
      setNextTask(null);
      return;
    }

    try {
      setIsLoadingTasks(true);
      clearError();
      
      // Load tasks from the TaskMaster API endpoint
      const response = await api.get(`/taskmaster/tasks/${encodeURIComponent(currentProject.name)}`);
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to load tasks');
      }
      
      const data = await response.json();
      
      setTasks(data.tasks || []);
      
      // Find next task (pending or in-progress)
      const nextTask = data.tasks?.find(task => 
        task.status === 'pending' || task.status === 'in-progress'
      ) || null;
      setNextTask(nextTask);
      
      
    } catch (err) {
      console.error('Error loading tasks:', err);
      handleError(err, 'load tasks');
      // Set empty state on error
      setTasks([]);
      setNextTask(null);
    } finally {
      setIsLoadingTasks(false);
    }
  }, [currentProject, user, token]);

  // Load initial data on mount or when auth changes
  useEffect(() => {
    if (!authLoading && user && token) {
      refreshProjects();
      refreshMCPStatus();
    } else {
      console.log('Auth not ready or no user, skipping project load:', { authLoading, user: !!user, token: !!token });
    }
  }, [refreshProjects, refreshMCPStatus, authLoading, user, token]);

  // Clear errors when authentication changes
  useEffect(() => {
    if (user && token) {
      clearError();
    }
  }, [user, token, clearError]);

  // Refresh tasks when current project changes
  useEffect(() => {
    if (currentProject?.name && user && token) {
      refreshTasks();
    }
  }, [currentProject?.name, user, token, refreshTasks]);

  // Handle WebSocket messages for TaskMaster updates
  useEffect(() => {
    const latestMessage = messages[messages.length - 1];
    if (!latestMessage) return;


    switch (latestMessage.type) {
      case 'taskmaster-project-updated':
        // Refresh projects when TaskMaster state changes
        if (latestMessage.projectName) {
          refreshProjects();
        }
        break;
        
      case 'taskmaster-tasks-updated':
        // Refresh tasks for the current project
        if (latestMessage.projectName === currentProject?.name) {
          refreshTasks();
        }
        break;
        
      case 'taskmaster-mcp-status-changed':
        // Refresh MCP server status
        refreshMCPStatus();
        break;
        
      default:
        // Ignore non-TaskMaster messages
        break;
    }
  }, [messages, refreshProjects, refreshTasks, refreshMCPStatus, currentProject]);

  // Context value
  const contextValue = {
    // State
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
    
    // Actions
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