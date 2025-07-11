import { useState, useCallback, useEffect } from 'react';
import { useProjectContext } from '../contexts/ProjectContext';
import { useProjectRegistration } from './useProjectRegistration';

// Project Mode States
export const PROJECT_MODE_STATES = {
  INACTIVE: 'inactive',
  ACTIVATING: 'activating', 
  ACTIVE: 'active',
  ERROR: 'error',
  RECOVERING: 'recovering'
};

// Project Mode Configuration
const DEFAULT_PROJECT_MODE_CONFIG = {
  autoActivateOnSelection: true,
  enableAutoSync: true,
  enableErrorRecovery: true,
  maxRetryAttempts: 3,
  retryDelay: 1000,
  contextPersistence: true
};

export function useProjectMode(config = {}) {
  const { 
    selectedProject, 
    markInitializationTime,
    addSessionHistoryEntry,
    updateProjectMetadata 
  } = useProjectContext();
  
  const { 
    registerProject,
    checkRegistration,
    syncProject,
    isLoading: isRegistrationLoading,
    error: registrationError
  } = useProjectRegistration();

  const [projectModeState, setProjectModeState] = useState(PROJECT_MODE_STATES.INACTIVE);
  const [projectModeConfig, setProjectModeConfig] = useState({
    ...DEFAULT_PROJECT_MODE_CONFIG,
    ...config
  });
  const [activationError, setActivationError] = useState(null);
  const [retryCount, setRetryCount] = useState(0);
  const [lastActivationTime, setLastActivationTime] = useState(null);
  const [projectModeMetrics, setProjectModeMetrics] = useState({
    totalActivations: 0,
    successfulActivations: 0,
    failedActivations: 0,
    averageActivationTime: 0,
    lastError: null
  });

  // Auto-activate project mode when project is selected
  useEffect(() => {
    if (selectedProject && projectModeConfig.autoActivateOnSelection) {
      activateProjectMode();
    }
  }, [selectedProject, projectModeConfig.autoActivateOnSelection]);

  // Activate Project Mode
  const activateProjectMode = useCallback(async () => {
    if (!selectedProject) {
      setActivationError('No project selected');
      return { success: false, error: 'No project selected' };
    }

    if (projectModeState === PROJECT_MODE_STATES.ACTIVATING) {
      return { success: false, error: 'Project mode already activating' };
    }

    const startTime = Date.now();
    setProjectModeState(PROJECT_MODE_STATES.ACTIVATING);
    setActivationError(null);

    try {
      // Step 1: Check if project is registered
      const isRegistered = await checkRegistration(selectedProject.fullPath);
      
      if (!isRegistered) {
        // Register the project
        const registrationResult = await registerProject({
          name: selectedProject.name,
          path: selectedProject.fullPath,
          displayName: selectedProject.displayName,
          type: 'opened',
          metadata: {
            activatedAt: new Date().toISOString(),
            projectModeEnabled: true
          }
        });

        if (!registrationResult.success) {
          throw new Error(registrationResult.error || 'Failed to register project');
        }
      }

      // Step 2: Sync project data
      if (projectModeConfig.enableAutoSync) {
        const syncResult = await syncProject(selectedProject.name);
        if (!syncResult.success) {
          console.warn('Project sync failed:', syncResult.error);
        }
      }

      // Step 3: Mark initialization time
      markInitializationTime(selectedProject.name);

      // Step 4: Add session history entry
      addSessionHistoryEntry(selectedProject.name, {
        action: 'project_mode_activated',
        timestamp: new Date().toISOString(),
        duration: Date.now() - startTime,
        config: projectModeConfig
      });

      // Step 5: Update project metadata
      updateProjectMetadata(selectedProject.name, {
        projectModeActive: true,
        lastActivation: new Date().toISOString(),
        activationCount: (selectedProject.metadata?.activationCount || 0) + 1
      });

      // Success - update state
      setProjectModeState(PROJECT_MODE_STATES.ACTIVE);
      setLastActivationTime(new Date());
      setRetryCount(0);
      
      // Update metrics
      const activationTime = Date.now() - startTime;
      setProjectModeMetrics(prev => ({
        ...prev,
        totalActivations: prev.totalActivations + 1,
        successfulActivations: prev.successfulActivations + 1,
        averageActivationTime: Math.round(
          (prev.averageActivationTime * prev.successfulActivations + activationTime) / 
          (prev.successfulActivations + 1)
        ),
        lastError: null
      }));

      return { 
        success: true, 
        activationTime,
        message: 'Project mode activated successfully' 
      };

    } catch (error) {
      console.error('Project mode activation failed:', error);
      
      setActivationError(error.message);
      setProjectModeState(PROJECT_MODE_STATES.ERROR);
      
      // Update metrics
      setProjectModeMetrics(prev => ({
        ...prev,
        totalActivations: prev.totalActivations + 1,
        failedActivations: prev.failedActivations + 1,
        lastError: error.message
      }));

      // Attempt recovery if enabled
      if (projectModeConfig.enableErrorRecovery && retryCount < projectModeConfig.maxRetryAttempts) {
        setTimeout(() => {
          setRetryCount(prev => prev + 1);
          recoverProjectMode();
        }, projectModeConfig.retryDelay);
      }

      return { 
        success: false, 
        error: error.message,
        retryCount: retryCount + 1
      };
    }
  }, [
    selectedProject,
    projectModeState,
    projectModeConfig,
    retryCount,
    checkRegistration,
    registerProject,
    syncProject,
    markInitializationTime,
    addSessionHistoryEntry,
    updateProjectMetadata
  ]);

  // Recover Project Mode
  const recoverProjectMode = useCallback(async () => {
    if (!selectedProject || retryCount >= projectModeConfig.maxRetryAttempts) {
      setProjectModeState(PROJECT_MODE_STATES.ERROR);
      return { success: false, error: 'Maximum retry attempts reached' };
    }

    setProjectModeState(PROJECT_MODE_STATES.RECOVERING);

    try {
      // Wait for recovery delay
      await new Promise(resolve => setTimeout(resolve, projectModeConfig.retryDelay));

      // Try to activate again
      const result = await activateProjectMode();
      
      if (result.success) {
        addSessionHistoryEntry(selectedProject.name, {
          action: 'project_mode_recovered',
          timestamp: new Date().toISOString(),
          retryCount,
          originalError: activationError
        });
      }

      return result;

    } catch (error) {
      console.error('Project mode recovery failed:', error);
      setProjectModeState(PROJECT_MODE_STATES.ERROR);
      return { success: false, error: error.message };
    }
  }, [selectedProject, retryCount, projectModeConfig, activationError, activateProjectMode, addSessionHistoryEntry]);

  // Deactivate Project Mode
  const deactivateProjectMode = useCallback(async () => {
    if (!selectedProject) {
      return { success: false, error: 'No project selected' };
    }

    try {
      // Update project metadata
      updateProjectMetadata(selectedProject.name, {
        projectModeActive: false,
        lastDeactivation: new Date().toISOString()
      });

      // Add session history entry
      addSessionHistoryEntry(selectedProject.name, {
        action: 'project_mode_deactivated',
        timestamp: new Date().toISOString(),
        duration: lastActivationTime ? Date.now() - lastActivationTime.getTime() : 0
      });

      setProjectModeState(PROJECT_MODE_STATES.INACTIVE);
      setActivationError(null);
      setRetryCount(0);
      setLastActivationTime(null);

      return { success: true, message: 'Project mode deactivated successfully' };

    } catch (error) {
      console.error('Project mode deactivation failed:', error);
      return { success: false, error: error.message };
    }
  }, [selectedProject, lastActivationTime, updateProjectMetadata, addSessionHistoryEntry]);

  // Toggle Project Mode
  const toggleProjectMode = useCallback(() => {
    if (projectModeState === PROJECT_MODE_STATES.ACTIVE) {
      return deactivateProjectMode();
    } else if (projectModeState === PROJECT_MODE_STATES.INACTIVE) {
      return activateProjectMode();
    }
    
    return { success: false, error: 'Cannot toggle project mode in current state' };
  }, [projectModeState, activateProjectMode, deactivateProjectMode]);

  // Update Project Mode Configuration
  const updateProjectModeConfig = useCallback((newConfig) => {
    setProjectModeConfig(prev => ({
      ...prev,
      ...newConfig
    }));
  }, []);

  // Get Project Mode Status
  const getProjectModeStatus = useCallback(() => {
    return {
      state: projectModeState,
      isActive: projectModeState === PROJECT_MODE_STATES.ACTIVE,
      isActivating: projectModeState === PROJECT_MODE_STATES.ACTIVATING,
      isError: projectModeState === PROJECT_MODE_STATES.ERROR,
      isRecovering: projectModeState === PROJECT_MODE_STATES.RECOVERING,
      error: activationError,
      retryCount,
      lastActivationTime,
      config: projectModeConfig,
      metrics: projectModeMetrics,
      selectedProject: selectedProject?.name || null
    };
  }, [
    projectModeState,
    activationError,
    retryCount,
    lastActivationTime,
    projectModeConfig,
    projectModeMetrics,
    selectedProject
  ]);

  return {
    // State
    projectModeState,
    isActive: projectModeState === PROJECT_MODE_STATES.ACTIVE,
    isActivating: projectModeState === PROJECT_MODE_STATES.ACTIVATING,
    isError: projectModeState === PROJECT_MODE_STATES.ERROR,
    isRecovering: projectModeState === PROJECT_MODE_STATES.RECOVERING,
    error: activationError,
    retryCount,
    lastActivationTime,
    metrics: projectModeMetrics,
    
    // Actions
    activateProjectMode,
    deactivateProjectMode,
    toggleProjectMode,
    recoverProjectMode,
    
    // Configuration
    config: projectModeConfig,
    updateConfig: updateProjectModeConfig,
    
    // Utilities
    getStatus: getProjectModeStatus,
    
    // Loading states
    isLoading: isRegistrationLoading || projectModeState === PROJECT_MODE_STATES.ACTIVATING,
    
    // Constants
    states: PROJECT_MODE_STATES
  };
}

// Simplified hook for basic project mode usage
export function useBasicProjectMode() {
  const {
    isActive,
    isActivating,
    isError,
    error,
    activateProjectMode,
    deactivateProjectMode,
    toggleProjectMode
  } = useProjectMode();

  return {
    isActive,
    isActivating,
    isError,
    error,
    activate: activateProjectMode,
    deactivate: deactivateProjectMode,
    toggle: toggleProjectMode
  };
}

// Hook for project mode metrics
export function useProjectModeMetrics() {
  const { metrics, getStatus } = useProjectMode();
  
  return {
    metrics,
    getStatus,
    getFullStatus: getStatus
  };
}