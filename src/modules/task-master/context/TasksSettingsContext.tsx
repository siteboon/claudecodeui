import { createContext, useContext, useState, useEffect } from 'react';
import type { Dispatch, ReactNode, SetStateAction } from 'react';

import { api } from '@/shared/api';

type TaskMasterInstallationStatus = {
  isReady?: boolean;
  installation?: {
    isInstalled?: boolean;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

type TasksSettingsContextValue = {
  tasksEnabled: boolean;
  setTasksEnabled: Dispatch<SetStateAction<boolean>>;
  toggleTasksEnabled: () => void;
  isTaskMasterInstalled: boolean | null;
  isTaskMasterReady: boolean | null;
  installationStatus: TaskMasterInstallationStatus | null;
  isCheckingInstallation: boolean;
};

const TasksSettingsContext = createContext<TasksSettingsContextValue>({
  tasksEnabled: true,
  setTasksEnabled: () => {},
  toggleTasksEnabled: () => {},
  isTaskMasterInstalled: null,
  isTaskMasterReady: null,
  installationStatus: null,
  isCheckingInstallation: true
});

export const useTasksSettings = () => {
  const context = useContext(TasksSettingsContext);
  if (!context) {
    throw new Error('useTasksSettings must be used within a TasksSettingsProvider');
  }
  return context;
};

/** Mounted by App.tsx; supplies the tasks-enabled preference and TaskMaster installation status that the chat, sidebar, settings and project-workspace modules read through useTasksSettings. */
export const TasksSettingsProvider = ({ children }: { children: ReactNode }) => {
  const [tasksEnabled, setTasksEnabled] = useState<boolean>(() => {
    // Load from localStorage on initialization
    const saved = localStorage.getItem('tasks-enabled');
    return saved !== null ? JSON.parse(saved) : true; // Default to true
  });

  const [isTaskMasterInstalled, setIsTaskMasterInstalled] = useState<boolean | null>(null);
  const [isTaskMasterReady, setIsTaskMasterReady] = useState<boolean | null>(null);
  const [installationStatus, setInstallationStatus] = useState<TaskMasterInstallationStatus | null>(null);
  const [isCheckingInstallation, setIsCheckingInstallation] = useState(true);

  // Save to localStorage whenever tasksEnabled changes
  useEffect(() => {
    localStorage.setItem('tasks-enabled', JSON.stringify(tasksEnabled));
  }, [tasksEnabled]);

  // Check TaskMaster installation status asynchronously on component mount
  useEffect(() => {
    const checkInstallation = async () => {
      try {
        const response = await api.taskmaster.installationStatus();
        if (response.ok) {
          const data = (await response.json()) as TaskMasterInstallationStatus;
          setInstallationStatus(data);
          setIsTaskMasterInstalled(data.installation?.isInstalled || false);
          setIsTaskMasterReady(data.isReady || false);

          // If TaskMaster is not installed and user hasn't explicitly enabled tasks,
          // disable tasks automatically
          const userEnabledTasks = localStorage.getItem('tasks-enabled');
          if (!data.installation?.isInstalled && !userEnabledTasks) {
            setTasksEnabled(false);
          }
        } else {
          console.error('Failed to check TaskMaster installation status');
          setIsTaskMasterInstalled(false);
          setIsTaskMasterReady(false);
        }
      } catch (error) {
        console.error('Error checking TaskMaster installation:', error);
        setIsTaskMasterInstalled(false);
        setIsTaskMasterReady(false);
      } finally {
        setIsCheckingInstallation(false);
      }
    };

    // Run check asynchronously without blocking initial render
    setTimeout(checkInstallation, 0);
  }, []);

  const toggleTasksEnabled = () => {
    setTasksEnabled(prev => !prev);
  };

  const contextValue: TasksSettingsContextValue = {
    tasksEnabled,
    setTasksEnabled,
    toggleTasksEnabled,
    isTaskMasterInstalled,
    isTaskMasterReady,
    installationStatus,
    isCheckingInstallation
  };

  return (
    <TasksSettingsContext.Provider value={contextValue}>
      {children}
    </TasksSettingsContext.Provider>
  );
};
