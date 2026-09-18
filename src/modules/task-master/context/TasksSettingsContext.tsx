import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { Dispatch, ReactNode, SetStateAction } from 'react';

import { api } from '@/shared/api';
import {
  readUserPreference,
  subscribeToUserPreferences,
  writeUserPreference,
} from '@/shared/userSettings';

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

/**
 * Tasks are off unless the user turns them on. The feature depends on an
 * external TaskMaster install, so defaulting it on put a Tasks tab and a chat
 * banner in front of everyone who had never heard of it.
 */
const TASKS_ENABLED_DEFAULT = false;

const TasksSettingsContext = createContext<TasksSettingsContextValue>({
  tasksEnabled: TASKS_ENABLED_DEFAULT,
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
  const [tasksEnabled, setTasksEnabled] = useState<boolean>(
    () => readUserPreference('tasksEnabled', TASKS_ENABLED_DEFAULT),
  );

  const [isTaskMasterInstalled, setIsTaskMasterInstalled] = useState<boolean | null>(null);
  const [isTaskMasterReady, setIsTaskMasterReady] = useState<boolean | null>(null);
  const [installationStatus, setInstallationStatus] = useState<TaskMasterInstallationStatus | null>(null);
  const [isCheckingInstallation, setIsCheckingInstallation] = useState(true);

  // Only a deliberate toggle is persisted. Persisting from an effect keyed on
  // the state would also fire on mount, writing the default before the user
  // had touched anything — which is exactly what made the previous
  // "has the user chosen?" check below unreachable.
  const chooseTasksEnabled = useCallback<Dispatch<SetStateAction<boolean>>>((update) => {
    setTasksEnabled((previous) => {
      const next = typeof update === 'function' ? update(previous) : update;
      writeUserPreference('tasksEnabled', next);
      return next;
    });
  }, []);

  // A choice made on another device arrives with the hydrated preferences.
  useEffect(() => subscribeToUserPreferences(() => {
    setTasksEnabled(readUserPreference('tasksEnabled', TASKS_ENABLED_DEFAULT));
  }), []);

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

          // If TaskMaster is not installed and the user has never made a
          // choice, disable tasks automatically — but never override a user
          // who deliberately turned them on.
          const userChoice = readUserPreference<boolean | null>('tasksEnabled', null);
          if (!data.installation?.isInstalled && userChoice === null) {
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

  const toggleTasksEnabled = useCallback(() => {
    chooseTasksEnabled(prev => !prev);
  }, [chooseTasksEnabled]);

  // A fresh object here would re-render every consumer on any render of this
  // provider, whether or not the settings moved.
  const contextValue = useMemo<TasksSettingsContextValue>(() => ({
    tasksEnabled,
    setTasksEnabled: chooseTasksEnabled,
    toggleTasksEnabled,
    isTaskMasterInstalled,
    isTaskMasterReady,
    installationStatus,
    isCheckingInstallation
  }), [
    chooseTasksEnabled,
    installationStatus,
    isCheckingInstallation,
    isTaskMasterInstalled,
    isTaskMasterReady,
    tasksEnabled,
    toggleTasksEnabled,
  ]);

  return (
    <TasksSettingsContext.Provider value={contextValue}>
      {children}
    </TasksSettingsContext.Provider>
  );
};
