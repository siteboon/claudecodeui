import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { api } from '../utils/api';
import { useAuth } from './AuthContext';
import { useWebSocket } from './WebSocketContext';

const BeadsContext = createContext({
  currentProject: null,
  projectBeads: null,
  issues: [],
  epics: [],
  readyIssues: [],
  isLoading: false,
  isLoadingIssues: false,
  error: null,
  setCurrentProject: () => {},
  refreshIssues: () => {},
  refreshEpics: () => {},
  refreshReadyIssues: () => {},
  getChildren: () => {},
  getDependencies: () => {},
  addDependency: () => {},
  removeDependency: () => {},
  createIssue: () => {},
  updateIssue: () => {},
  closeIssue: () => {},
  reopenIssue: () => {},
  clearError: () => {}
});

export const useBeads = () => {
  const context = useContext(BeadsContext);
  if (!context) {
    throw new Error('useBeads must be used within a BeadsProvider');
  }
  return context;
};

export const BeadsProvider = ({ children }) => {
  const { latestMessage } = useWebSocket();
  const { user, token } = useAuth();
  
  const [currentProject, setCurrentProjectState] = useState(null);
  const [projectBeads, setProjectBeads] = useState(null);
  const [issues, setIssues] = useState([]);
  const [epics, setEpics] = useState([]);
  const [readyIssues, setReadyIssues] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingIssues, setIsLoadingIssues] = useState(false);
  const [error, setError] = useState(null);
  
  const isLoadingRef = useRef(false);
  const lastProjectRef = useRef(null);

  const handleError = (error, context) => {
    console.error(`Beads ${context} error:`, error);
    setError({
      message: error.message || `Failed to ${context}`,
      context,
      timestamp: new Date().toISOString()
    });
  };

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const setCurrentProject = useCallback((project) => {
    setCurrentProjectState(project);
    setProjectBeads(project?.beads || null);
    setIssues([]);
    setEpics([]);
    setReadyIssues([]);
    lastProjectRef.current = null;
  }, []);

  const refreshIssues = useCallback(async (force = false) => {
    if (!currentProject?.name) {
      setIssues([]);
      return;
    }

    if (!user || !token) {
      setIssues([]);
      return;
    }

    if (isLoadingRef.current && !force) {
      return;
    }

    try {
      isLoadingRef.current = true;
      setIsLoadingIssues(true);
      clearError();
      
      const response = await api.get(`/beads/issues/${encodeURIComponent(currentProject.name)}`);
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to load issues');
      }
      
      const data = await response.json();
      setIssues(data.issues || []);
      
    } catch (err) {
      console.error('Error loading issues:', err);
      handleError(err, 'load issues');
      setIssues([]);
    } finally {
      setIsLoadingIssues(false);
      isLoadingRef.current = false;
    }
  }, [currentProject?.name, user, token, clearError]);

  const refreshEpics = useCallback(async () => {
    if (!currentProject?.name) return;
    if (!user || !token) return;

    try {
      const response = await api.get(`/beads/epics/${encodeURIComponent(currentProject.name)}`);
      
      if (!response.ok) return;
      
      const data = await response.json();
      setEpics(data.epics || []);
      
    } catch (err) {
      console.error('Error loading epics:', err);
    }
  }, [currentProject?.name, user, token]);

  const refreshReadyIssues = useCallback(async () => {
    if (!currentProject?.name) return;
    if (!user || !token) return;

    try {
      const response = await api.get(`/beads/ready/${encodeURIComponent(currentProject.name)}`);
      
      if (!response.ok) return;
      
      const data = await response.json();
      setReadyIssues(data.issues || []);
      
    } catch (err) {
      console.error('Error loading ready issues:', err);
      setReadyIssues([]);
    }
  }, [currentProject?.name, user, token]);

  const getChildren = useCallback(async (issueId) => {
    if (!currentProject?.name) return [];
    if (!user || !token) return [];

    try {
      const response = await api.get(`/beads/children/${encodeURIComponent(currentProject.name)}/${encodeURIComponent(issueId)}`);
      
      if (!response.ok) return [];
      
      const data = await response.json();
      return data.children || [];
      
    } catch (err) {
      console.error('Error loading children:', err);
      return [];
    }
  }, [currentProject?.name, user, token]);

  const getDependencies = useCallback(async (issueId) => {
    if (!currentProject?.name) return [];
    if (!user || !token) return [];

    try {
      const response = await api.get(`/beads/dependencies/${encodeURIComponent(currentProject.name)}/${encodeURIComponent(issueId)}`);
      
      if (!response.ok) return [];
      
      const data = await response.json();
      return data.dependencies || [];
      
    } catch (err) {
      console.error('Error loading dependencies:', err);
      return [];
    }
  }, [currentProject?.name, user, token]);

  const addDependency = useCallback(async (blockedId, blockerId) => {
    if (!currentProject?.name) {
      throw new Error('No project selected');
    }

    const response = await api.post(`/beads/dependency/${encodeURIComponent(currentProject.name)}`, {
      blockedId,
      blockerId
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.message || 'Failed to add dependency');
    }
    
    await refreshIssues(true);
    return response.json();
  }, [currentProject?.name, refreshIssues]);

  const removeDependency = useCallback(async (blockedId, blockerId) => {
    if (!currentProject?.name) {
      throw new Error('No project selected');
    }

    const response = await api.delete(`/beads/dependency/${encodeURIComponent(currentProject.name)}`, {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blockedId, blockerId })
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.message || 'Failed to remove dependency');
    }
    
    await refreshIssues(true);
    return response.json();
  }, [currentProject?.name, refreshIssues]);

  const createIssue = useCallback(async (issueData) => {
    if (!currentProject?.name) {
      throw new Error('No project selected');
    }

    const response = await api.post(`/beads/create/${encodeURIComponent(currentProject.name)}`, issueData);
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.message || 'Failed to create issue');
    }
    
    await refreshIssues(true);
    await refreshEpics();
    return response.json();
  }, [currentProject?.name, refreshIssues, refreshEpics]);

  const updateIssue = useCallback(async (issueId, updateData) => {
    if (!currentProject?.name) {
      throw new Error('No project selected');
    }

    const response = await api.put(`/beads/update/${encodeURIComponent(currentProject.name)}/${encodeURIComponent(issueId)}`, updateData);
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.message || 'Failed to update issue');
    }
    
    await refreshIssues(true);
    return response.json();
  }, [currentProject?.name, refreshIssues]);

  const closeIssue = useCallback(async (issueId) => {
    if (!currentProject?.name) {
      throw new Error('No project selected');
    }

    const response = await api.post(`/beads/close/${encodeURIComponent(currentProject.name)}/${encodeURIComponent(issueId)}`);
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.message || 'Failed to close issue');
    }
    
    await refreshIssues(true);
    await refreshReadyIssues();
    return response.json();
  }, [currentProject?.name, refreshIssues, refreshReadyIssues]);

  const reopenIssue = useCallback(async (issueId) => {
    if (!currentProject?.name) {
      throw new Error('No project selected');
    }

    const response = await api.post(`/beads/reopen/${encodeURIComponent(currentProject.name)}/${encodeURIComponent(issueId)}`);
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.message || 'Failed to reopen issue');
    }
    
    await refreshIssues(true);
    return response.json();
  }, [currentProject?.name, refreshIssues]);

  useEffect(() => {
    if (currentProject?.name && user && token) {
      if (lastProjectRef.current !== currentProject.name) {
        lastProjectRef.current = currentProject.name;
        refreshIssues();
        refreshEpics();
        refreshReadyIssues();
      }
    }
  }, [currentProject?.name, user, token, refreshIssues, refreshEpics, refreshReadyIssues]);

  useEffect(() => {
    if (user && token) {
      clearError();
    }
  }, [user, token, clearError]);

  useEffect(() => {
    if (!latestMessage) return;
    if (!currentProject?.name) return;

    switch (latestMessage.type) {
      case 'beads-project-updated':
      case 'beads-issues-updated':
      case 'beads-update':
        if (latestMessage.projectName === currentProject.name) {
          refreshIssues(true);
          refreshEpics();
          refreshReadyIssues();
        }
        break;
        
      default:
        break;
    }
  }, [latestMessage, currentProject?.name, refreshIssues, refreshEpics, refreshReadyIssues]);

  const contextValue = {
    currentProject,
    projectBeads,
    issues,
    epics,
    readyIssues,
    isLoading,
    isLoadingIssues,
    error,
    setCurrentProject,
    refreshIssues,
    refreshEpics,
    refreshReadyIssues,
    getChildren,
    getDependencies,
    addDependency,
    removeDependency,
    createIssue,
    updateIssue,
    closeIssue,
    reopenIssue,
    clearError
  };

  return (
    <BeadsContext.Provider value={contextValue}>
      {children}
    </BeadsContext.Provider>
  );
};

export default BeadsContext;
