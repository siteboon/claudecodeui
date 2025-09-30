/*
 * MainContent.jsx - Main Content Area with Session Protection Props Passthrough
 * 
 * SESSION PROTECTION PASSTHROUGH:
 * ===============================
 * 
 * This component serves as a passthrough layer for Session Protection functions:
 * - Receives session management functions from App.jsx
 * - Passes them down to ChatInterface.jsx
 * 
 * No session protection logic is implemented here - it's purely a props bridge.
 */

import React, { useState, useEffect } from 'react';
import ChatInterface from './ChatInterface';
import FileTree from './FileTree';
import CodeEditor from './CodeEditor';
import StandaloneShell from './StandaloneShell';
import GitPanel from './GitPanel';
import ErrorBoundary from './ErrorBoundary';
import ClaudeLogo from './ClaudeLogo';
import CursorLogo from './CursorLogo';
import TaskList from './TaskList';
import TaskDetail from './TaskDetail';
import PRDEditor from './PRDEditor';
import Tooltip from './Tooltip';
import { useTaskMaster } from '../contexts/TaskMasterContext';
import { useTasksSettings } from '../contexts/TasksSettingsContext';
import { api } from '../utils/api';

function MainContent({ 
  selectedProject, 
  selectedSession, 
  activeTab, 
  setActiveTab, 
  ws, 
  sendMessage, 
  messages,
  isMobile,
  isPWA,
  onMenuClick,
  isLoading,
  onInputFocusChange,
  // Session Protection Props: Functions passed down from App.jsx to manage active session state
  // These functions control when project updates are paused during active conversations
  onSessionActive,        // Mark session as active when user sends message
  onSessionInactive,      // Mark session as inactive when conversation completes/aborts  
  onReplaceTemporarySession, // Replace temporary session ID with real session ID from WebSocket
  onNavigateToSession,    // Navigate to a specific session (for Claude CLI session duplication workaround)
  onShowSettings,         // Show tools settings panel
  autoExpandTools,        // Auto-expand tool accordions
  showRawParameters,      // Show raw parameters in tool accordions
  autoScrollToBottom,     // Auto-scroll to bottom when new messages arrive
  sendByCtrlEnter         // Send by Ctrl+Enter mode for East Asian language input
}) {
  const [editingFile, setEditingFile] = useState(null);
  const [selectedTask, setSelectedTask] = useState(null);
  const [showTaskDetail, setShowTaskDetail] = useState(false);
  
  // PRD Editor state
  const [showPRDEditor, setShowPRDEditor] = useState(false);
  const [selectedPRD, setSelectedPRD] = useState(null);
  const [existingPRDs, setExistingPRDs] = useState([]);
  const [prdNotification, setPRDNotification] = useState(null);
  
  // TaskMaster context
  const { tasks, currentProject, refreshTasks, setCurrentProject } = useTaskMaster();
  const { tasksEnabled, isTaskMasterInstalled, isTaskMasterReady } = useTasksSettings();
  
  // Only show tasks tab if TaskMaster is installed and enabled
  const shouldShowTasksTab = tasksEnabled && isTaskMasterInstalled;

  // Sync selectedProject with TaskMaster context
  useEffect(() => {
    if (selectedProject && selectedProject !== currentProject) {
      setCurrentProject(selectedProject);
    }
  }, [selectedProject, currentProject, setCurrentProject]);

  // Switch away from tasks tab when tasks are disabled or TaskMaster is not installed
  useEffect(() => {
    if (!shouldShowTasksTab && activeTab === 'tasks') {
      setActiveTab('chat');
    }
  }, [shouldShowTasksTab, activeTab, setActiveTab]);

  // Load existing PRDs when current project changes
  useEffect(() => {
    const loadExistingPRDs = async () => {
      if (!currentProject?.name) {
        setExistingPRDs([]);
        return;
      }
      
      try {
        const response = await api.get(`/taskmaster/prd/${encodeURIComponent(currentProject.name)}`);
        if (response.ok) {
          const data = await response.json();
          setExistingPRDs(data.prdFiles || []);
        } else {
          setExistingPRDs([]);
        }
      } catch (error) {
        console.error('Failed to load existing PRDs:', error);
        setExistingPRDs([]);
      }
    };

    loadExistingPRDs();
  }, [currentProject?.name]);

  const handleFileOpen = (filePath, diffInfo = null) => {
    // Create a file object that CodeEditor expects
    const file = {
      name: filePath.split('/').pop(),
      path: filePath,
      projectName: selectedProject?.name,
      diffInfo: diffInfo // Pass along diff information if available
    };
    setEditingFile(file);
  };

  const handleCloseEditor = () => {
    setEditingFile(null);
  };

  const handleTaskClick = (task) => {
    // If task is just an ID (from dependency click), find the full task object
    if (typeof task === 'object' && task.id && !task.title) {
      const fullTask = tasks?.find(t => t.id === task.id);
      if (fullTask) {
        setSelectedTask(fullTask);
        setShowTaskDetail(true);
      }
    } else {
      setSelectedTask(task);
      setShowTaskDetail(true);
    }
  };

  const handleTaskDetailClose = () => {
    setShowTaskDetail(false);
    setSelectedTask(null);
  };

  const handleTaskStatusChange = (taskId, newStatus) => {
    // This would integrate with TaskMaster API to update task status
    console.log('Update task status:', taskId, newStatus);
    refreshTasks?.();
  };
  if (isLoading) {
    return (
      <div className="h-full flex flex-col">
        {/* Header with menu button for mobile */}
        {isMobile && (
          <div 
            className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 p-3 sm:p-4 pwa-header-safe flex-shrink-0"
          >
            <button
              onClick={onMenuClick}
              className="p-1.5 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 pwa-menu-button"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
          </div>
        )}
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center text-gray-500 dark:text-gray-400">
            <div className="w-12 h-12 mx-auto mb-4">
              <div 
                className="w-full h-full rounded-full border-4 border-gray-200 border-t-blue-500" 
                style={{ 
                  animation: 'spin 1s linear infinite',
                  WebkitAnimation: 'spin 1s linear infinite',
                  MozAnimation: 'spin 1s linear infinite'
                }} 
              />
            </div>
            <h2 className="text-xl font-semibold mb-2">Loading Claude Code UI</h2>
            <p>Setting up your workspace...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!selectedProject) {
    return (
      <div className="h-full flex flex-col">
        {/* Header with menu button for mobile */}
        {isMobile && (
          <div 
            className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 p-3 sm:p-4 pwa-header-safe flex-shrink-0"
          >
            <button
              onClick={onMenuClick}
              className="p-1.5 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 pwa-menu-button"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
          </div>
        )}
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center text-gray-500 dark:text-gray-400 max-w-md mx-auto px-6">
            <div className="w-16 h-16 mx-auto mb-6 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center">
              <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-5l-2-2H5a2 2 0 00-2 2z" />
              </svg>
            </div>
            <h2 className="text-2xl font-semibold mb-3 text-gray-900 dark:text-white">Choose Your Project</h2>
            <p className="text-gray-600 dark:text-gray-300 mb-6 leading-relaxed">
              Select a project from the sidebar to start coding with Claude. Each project contains your chat sessions and file history.
            </p>
            <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4 border border-blue-200 dark:border-blue-800">
              <p className="text-sm text-blue-700 dark:text-blue-300">
                💡 <strong>Tip:</strong> {isMobile ? 'Tap the menu button above to access projects' : 'Create a new project by clicking the folder icon in the sidebar'}
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header with tabs */}
      <div 
        className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 p-3 sm:p-4 pwa-header-safe flex-shrink-0"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2 sm:space-x-3">
            {isMobile && (
              <button
                onClick={onMenuClick}
                onTouchStart={(e) => {
                  e.preventDefault();
                  onMenuClick();
                }}
                className="p-2.5 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 touch-manipulation active:scale-95 pwa-menu-button"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
            )}
            <div className="min-w-0 flex items-center gap-2">
              {activeTab === 'chat' && selectedSession && (
                <div className="w-6 h-6 flex-shrink-0 flex items-center justify-center">
                  {selectedSession.__provider === 'cursor' ? (
                    <CursorLogo className="w-5 h-5" />
                  ) : (
                    <ClaudeLogo className="w-5 h-5" />
                  )}
                </div>
              )}
              <div className="flex-1 min-w-0">
                {activeTab === 'chat' && selectedSession ? (
                  <div>
                    <h2 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white truncate">
                      {selectedSession.__provider === 'cursor' ? (selectedSession.name || 'Untitled Session') : (selectedSession.summary || 'New Session')}
                    </h2>
                    <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                      {selectedProject.displayName} <span className="hidden sm:inline">• {selectedSession.id}</span>
                    </div>
                  </div>
                ) : activeTab === 'chat' && !selectedSession ? (
                  <div>
                    <h2 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white">
                      New Session
                    </h2>
                    <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                      {selectedProject.displayName}
                    </div>
                  </div>
                ) : (
                  <div>
                    <h2 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white">
                      {activeTab === 'files' ? 'Project Files' : 
                       activeTab === 'git' ? 'Source Control' : 
                       (activeTab === 'tasks' && shouldShowTasksTab) ? 'TaskMaster' : 
                       'Project'}
                    </h2>
                    <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                      {selectedProject.displayName}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
          
          {/* Modern Tab Navigation - Right Side */}
          <div className="flex-shrink-0 hidden sm:block">
            <div className="relative flex bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
              <Tooltip content="Chat" position="bottom">
                <button
                  onClick={() => setActiveTab('chat')}
                  className={`relative px-2 sm:px-3 py-1.5 text-xs sm:text-sm font-medium rounded-md ${
                    activeTab === 'chat'
                      ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                      : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-gray-700'
                  }`}
                >
                  <span className="flex items-center gap-1 sm:gap-1.5">
                    <svg className="w-3 sm:w-3.5 h-3 sm:h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                    <span className="hidden md:hidden lg:inline">Chat</span>
                  </span>
                </button>
              </Tooltip>
              <Tooltip content="Shell" position="bottom">
                <button
                  onClick={() => setActiveTab('shell')}
                  className={`relative px-2 sm:px-3 py-1.5 text-xs sm:text-sm font-medium rounded-md transition-all duration-200 ${
                    activeTab === 'shell'
                      ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                      : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-gray-700'
                  }`}
                >
                  <span className="flex items-center gap-1 sm:gap-1.5">
                    <svg className="w-3 sm:w-3.5 h-3 sm:h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v14a2 2 0 002 2z" />
                    </svg>
                    <span className="hidden md:hidden lg:inline">Shell</span>
                  </span>
                </button>
              </Tooltip>
              <Tooltip content="Files" position="bottom">
                <button
                  onClick={() => setActiveTab('files')}
                  className={`relative px-2 sm:px-3 py-1.5 text-xs sm:text-sm font-medium rounded-md transition-all duration-200 ${
                    activeTab === 'files'
                      ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                      : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-gray-700'
                  }`}
                >
                  <span className="flex items-center gap-1 sm:gap-1.5">
                    <svg className="w-3 sm:w-3.5 h-3 sm:h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-5l-2-2H5a2 2 0 00-2 2z" />
                    </svg>
                    <span className="hidden md:hidden lg:inline">Files</span>
                  </span>
                </button>
              </Tooltip>
              <Tooltip content="Source Control" position="bottom">
                <button
                  onClick={() => setActiveTab('git')}
                  className={`relative px-2 sm:px-3 py-1.5 text-xs sm:text-sm font-medium rounded-md transition-all duration-200 ${
                    activeTab === 'git'
                      ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                      : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-gray-700'
                  }`}
                >
                  <span className="flex items-center gap-1 sm:gap-1.5">
                    <svg className="w-3 sm:w-3.5 h-3 sm:h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    <span className="hidden md:hidden lg:inline">Source Control</span>
                  </span>
                </button>
              </Tooltip>
              {shouldShowTasksTab && (
                <Tooltip content="Tasks" position="bottom">
                  <button
                    onClick={() => setActiveTab('tasks')}
                    className={`relative px-2 sm:px-3 py-1.5 text-xs sm:text-sm font-medium rounded-md transition-all duration-200 ${
                      activeTab === 'tasks'
                        ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                        : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-gray-700'
                    }`}
                  >
                    <span className="flex items-center gap-1 sm:gap-1.5">
                      <svg className="w-3 sm:w-3.5 h-3 sm:h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                      </svg>
                      <span className="hidden md:hidden lg:inline">Tasks</span>
                    </span>
                  </button>
                </Tooltip>
              )}
               {/* <button
                onClick={() => setActiveTab('preview')}
                className={`relative px-2 sm:px-3 py-1.5 text-xs sm:text-sm font-medium rounded-md transition-all duration-200 ${
                  activeTab === 'preview'
                    ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-gray-700'
                }`}
              > 
                <span className="flex items-center gap-1 sm:gap-1.5">
                  <svg className="w-3 sm:w-3.5 h-3 sm:h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                  </svg>
                  <span className="hidden sm:inline">Preview</span>
                </span>
              </button> */}
            </div>
          </div>
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        <div className={`h-full ${activeTab === 'chat' ? 'block' : 'hidden'}`}>
          <ErrorBoundary showDetails={true}>
            <ChatInterface
              selectedProject={selectedProject}
              selectedSession={selectedSession}
              ws={ws}
              sendMessage={sendMessage}
              messages={messages}
              onFileOpen={handleFileOpen}
              onInputFocusChange={onInputFocusChange}
              onSessionActive={onSessionActive}
              onSessionInactive={onSessionInactive}
              onReplaceTemporarySession={onReplaceTemporarySession}
              onNavigateToSession={onNavigateToSession}
              onShowSettings={onShowSettings}
              autoExpandTools={autoExpandTools}
              showRawParameters={showRawParameters}
              autoScrollToBottom={autoScrollToBottom}
              sendByCtrlEnter={sendByCtrlEnter}
              onShowAllTasks={tasksEnabled ? () => setActiveTab('tasks') : null}
            />
          </ErrorBoundary>
        </div>
        <div className={`h-full overflow-hidden ${activeTab === 'files' ? 'block' : 'hidden'}`}>
          <FileTree selectedProject={selectedProject} />
        </div>
        <div className={`h-full overflow-hidden ${activeTab === 'shell' ? 'block' : 'hidden'}`}>
          <StandaloneShell
            project={selectedProject}
            session={selectedSession}
            isActive={activeTab === 'shell'}
            showHeader={false}
          />
        </div>
        <div className={`h-full overflow-hidden ${activeTab === 'git' ? 'block' : 'hidden'}`}>
          <GitPanel selectedProject={selectedProject} isMobile={isMobile} />
        </div>
        {shouldShowTasksTab && (
          <div className={`h-full ${activeTab === 'tasks' ? 'block' : 'hidden'}`}>
            <div className="h-full flex flex-col overflow-hidden">
              <TaskList
                tasks={tasks || []}
                onTaskClick={handleTaskClick}
                showParentTasks={true}
                className="flex-1 overflow-y-auto p-4"
                currentProject={currentProject}
                onTaskCreated={refreshTasks}
                onShowPRDEditor={(prd = null) => {
                  setSelectedPRD(prd);
                  setShowPRDEditor(true);
                }}
                existingPRDs={existingPRDs}
                onRefreshPRDs={(showNotification = false) => {
                  // Reload existing PRDs
                  if (currentProject?.name) {
                    api.get(`/taskmaster/prd/${encodeURIComponent(currentProject.name)}`)
                      .then(response => response.ok ? response.json() : Promise.reject())
                      .then(data => {
                        setExistingPRDs(data.prdFiles || []);
                        if (showNotification) {
                          setPRDNotification('PRD saved successfully!');
                          setTimeout(() => setPRDNotification(null), 3000);
                        }
                      })
                      .catch(error => console.error('Failed to refresh PRDs:', error));
                  }
                }}
              />
            </div>
          </div>
        )}
        <div className={`h-full overflow-hidden ${activeTab === 'preview' ? 'block' : 'hidden'}`}>
          {/* <LivePreviewPanel
            selectedProject={selectedProject}
            serverStatus={serverStatus}
            serverUrl={serverUrl}
            availableScripts={availableScripts}
            onStartServer={(script) => {
              sendMessage({
                type: 'server:start',
                projectPath: selectedProject?.fullPath,
                script: script
              });
            }}
            onStopServer={() => {
              sendMessage({
                type: 'server:stop',
                projectPath: selectedProject?.fullPath
              });
            }}
            onScriptSelect={setCurrentScript}
            currentScript={currentScript}
            isMobile={isMobile}
            serverLogs={serverLogs}
            onClearLogs={() => setServerLogs([])}
          /> */}
        </div>
      </div>

      {/* Code Editor Modal */}
      {editingFile && (
        <CodeEditor
          file={editingFile}
          onClose={handleCloseEditor}
          projectPath={selectedProject?.path}
        />
      )}

      {/* Task Detail Modal */}
      {shouldShowTasksTab && showTaskDetail && selectedTask && (
        <TaskDetail
          task={selectedTask}
          isOpen={showTaskDetail}
          onClose={handleTaskDetailClose}
          onStatusChange={handleTaskStatusChange}
          onTaskClick={handleTaskClick}
        />
      )}
      {/* PRD Editor Modal */}
      {showPRDEditor && (
        <PRDEditor
          project={currentProject}
          projectPath={currentProject?.fullPath || currentProject?.path}
          onClose={() => {
            setShowPRDEditor(false);
            setSelectedPRD(null);
          }}
          isNewFile={!selectedPRD?.isExisting}
          file={{ 
            name: selectedPRD?.name || 'prd.txt',
            content: selectedPRD?.content || ''
          }}
          onSave={async () => {
            setShowPRDEditor(false);
            setSelectedPRD(null);
            
            // Reload existing PRDs with notification
            try {
              const response = await api.get(`/taskmaster/prd/${encodeURIComponent(currentProject.name)}`);
              if (response.ok) {
                const data = await response.json();
                setExistingPRDs(data.prdFiles || []);
                setPRDNotification('PRD saved successfully!');
                setTimeout(() => setPRDNotification(null), 3000);
              }
            } catch (error) {
              console.error('Failed to refresh PRDs:', error);
            }
            
            refreshTasks?.();
          }}
        />
      )}
      {/* PRD Notification */}
      {prdNotification && (
        <div className="fixed bottom-4 right-4 z-50 animate-in slide-in-from-bottom-2 duration-300">
          <div className="bg-green-600 text-white px-4 py-3 rounded-lg shadow-lg flex items-center gap-3">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <span className="font-medium">{prdNotification}</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default React.memo(MainContent);