import React, { createContext, useContext, useState, useEffect } from 'react';
import { api } from '../utils/api';

const TasksSettingsContext = createContext({
  tasksEnabled: true,
  setTasksEnabled: () => {},
  toggleTasksEnabled: () => {},
  isTaskMasterInstalled: null,
  isTaskMasterReady: null,
  installationStatus: null,
  isBeadsInstalled: null,
  isBeadsReady: null,
  beadsInstallationStatus: null,
  isCheckingInstallation: true
});

export const useTasksSettings = () => {
  const context = useContext(TasksSettingsContext);
  if (!context) {
    throw new Error('useTasksSettings must be used within a TasksSettingsProvider');
  }
  return context;
};

export const TasksSettingsProvider = ({ children }) => {
  const [tasksEnabled, setTasksEnabled] = useState(() => {
    const saved = localStorage.getItem('tasks-enabled');
    return saved !== null ? JSON.parse(saved) : true;
  });
  
  const [isTaskMasterInstalled, setIsTaskMasterInstalled] = useState(null);
  const [isTaskMasterReady, setIsTaskMasterReady] = useState(null);
  const [installationStatus, setInstallationStatus] = useState(null);
  
  const [isBeadsInstalled, setIsBeadsInstalled] = useState(null);
  const [isBeadsReady, setIsBeadsReady] = useState(null);
  const [beadsInstallationStatus, setBeadsInstallationStatus] = useState(null);
  
  const [isCheckingInstallation, setIsCheckingInstallation] = useState(true);

  useEffect(() => {
    localStorage.setItem('tasks-enabled', JSON.stringify(tasksEnabled));
  }, [tasksEnabled]);

  useEffect(() => {
    const checkInstallation = async () => {
      try {
        const [taskmasterResponse, beadsResponse] = await Promise.all([
          api.get('/taskmaster/installation-status'),
          api.get('/beads/installation-status')
        ]);
        
        let tmInstalled = false;
        let tmReady = false;
        let bdInstalled = false;
        let bdReady = false;
        
        if (taskmasterResponse.ok) {
          const data_tm = await taskmasterResponse.json();
          setInstallationStatus(data_tm);
          tmInstalled = data_tm.installation?.isInstalled || false;
          tmReady = data_tm.isReady || false;
          setIsTaskMasterInstalled(tmInstalled);
          setIsTaskMasterReady(tmReady);
        } else {
          console.error('Failed to check TaskMaster installation status');
          setIsTaskMasterInstalled(false);
          setIsTaskMasterReady(false);
        }
        
        if (beadsResponse.ok) {
          const data_bd = await beadsResponse.json();
          setBeadsInstallationStatus(data_bd);
          bdInstalled = data_bd.installation?.isInstalled || false;
          bdReady = data_bd.isReady || false;
          setIsBeadsInstalled(bdInstalled);
          setIsBeadsReady(bdReady);
        } else {
          console.error('Failed to check Beads installation status');
          setIsBeadsInstalled(false);
          setIsBeadsReady(false);
        }
        
        const userEnabledTasks = localStorage.getItem('tasks-enabled');
        if (!tmInstalled && !bdInstalled && !userEnabledTasks) {
          setTasksEnabled(false);
        }
      } catch (error) {
        console.error('Error checking installation:', error);
        setIsTaskMasterInstalled(false);
        setIsTaskMasterReady(false);
        setIsBeadsInstalled(false);
        setIsBeadsReady(false);
      } finally {
        setIsCheckingInstallation(false);
      }
    };

    setTimeout(checkInstallation, 0);
  }, []);

  const toggleTasksEnabled = () => {
    setTasksEnabled(prev => !prev);
  };

  const contextValue = {
    tasksEnabled,
    setTasksEnabled,
    toggleTasksEnabled,
    isTaskMasterInstalled,
    isTaskMasterReady,
    installationStatus,
    isBeadsInstalled,
    isBeadsReady,
    beadsInstallationStatus,
    isCheckingInstallation
  };

  return (
    <TasksSettingsContext.Provider value={contextValue}>
      {children}
    </TasksSettingsContext.Provider>
  );
};

export default TasksSettingsContext;
