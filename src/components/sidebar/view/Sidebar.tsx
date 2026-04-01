import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useDeviceSettings } from '../../../hooks/useDeviceSettings';
import { useVersionCheck } from '../../../hooks/useVersionCheck';
import { useUiPreferences } from '../../../hooks/useUiPreferences';
import { useSidebarController } from '../hooks/useSidebarController';
import { useTaskMaster } from '../../../contexts/TaskMasterContext';
import { useTasksSettings } from '../../../contexts/TasksSettingsContext';
import type { Project, SessionProvider } from '../../../types/app';
import type { MCPServerStatus, SidebarProps } from '../types/types';
import SidebarCollapsed from './subcomponents/SidebarCollapsed';
import SidebarContent from './subcomponents/SidebarContent';
import SidebarModals from './subcomponents/SidebarModals';
import type { SidebarProjectListProps } from './subcomponents/SidebarProjectList';

type TaskMasterSidebarContext = {
  setCurrentProject: (project: Project) => void;
  mcpServerStatus: MCPServerStatus;
};

function Sidebar({
  projects,
  selectedProject,
  selectedSession,
  onProjectSelect,
  onSessionSelect,
  onNewSession,
  onSessionDelete,
  onProjectDelete,
  isLoading,
  loadingProgress,
  onRefresh,
  onShowSettings,
  showSettings,
  settingsInitialTab,
  onCloseSettings,
  isMobile,
}: SidebarProps) {
  const { t } = useTranslation(['sidebar', 'common']);
  const { isPWA } = useDeviceSettings({ trackMobile: false });
  const { updateAvailable, latestVersion, currentVersion, releaseInfo, installMode } = useVersionCheck(
    'siteboon',
    'claudecodeui',
  );
  const { preferences, setPreference } = useUiPreferences();
  const { sidebarVisible } = preferences;
  const { setCurrentProject, mcpServerStatus } = useTaskMaster() as TaskMasterSidebarContext;
  const { tasksEnabled } = useTasksSettings();

  const {
    isSidebarCollapsed,
    expandedProjects,
    editingProject,
    showNewProject,
    editingName,
    loadingSessions,
    initialSessionsLoaded,
    currentTime,
    isRefreshing,
    editingSession,
    editingSessionName,
    searchFilter,
    searchMode,
    setSearchMode,
    conversationResults,
    isSearching,
    searchProgress,
    clearConversationResults,
    deletingProjects,
    deleteConfirmation,
    sessionDeleteConfirmation,
    showVersionModal,
    filteredProjects,
    toggleProject,
    handleSessionClick,
    toggleStarProject,
    isProjectStarred,
    getProjectSessions,
    startEditing,
    cancelEditing,
    saveProjectName,
    showDeleteSessionConfirmation,
    confirmDeleteSession,
    requestProjectDelete,
    confirmDeleteProject,
    loadMoreSessions,
    handleProjectSelect,
    refreshProjects,
    updateSessionSummary,
    collapseSidebar: handleCollapseSidebar,
    expandSidebar: handleExpandSidebar,
    setShowNewProject,
    setEditingName,
    setEditingSession,
    setEditingSessionName,
    setSearchFilter,
    setDeleteConfirmation,
    setSessionDeleteConfirmation,
    setShowVersionModal,
  } = useSidebarController({
    projects,
    selectedProject,
    selectedSession,
    isLoading,
    isMobile,
    t,
    onRefresh,
    onProjectSelect,
    onSessionSelect,
    onSessionDelete,
    onProjectDelete,
    setCurrentProject,
    setSidebarVisible: (visible) => setPreference('sidebarVisible', visible),
    sidebarVisible,
  });

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    document.documentElement.classList.toggle('pwa-mode', isPWA);
    document.body.classList.toggle('pwa-mode', isPWA);
  }, [isPWA]);

  const handleProjectCreated = () => {
    if (window.refreshProjects) {
      void window.refreshProjects();
      return;
    }

    window.location.reload();
  };

  const projectListProps: SidebarProjectListProps = {
    projects,
    filteredProjects,
    selectedProject,
    selectedSession,
    isLoading,
    loadingProgress,
    expandedProjects,
    editingProject,
    editingName,
    loadingSessions,
    initialSessionsLoaded,
    currentTime,
    editingSession,
    editingSessionName,
    deletingProjects,
    tasksEnabled,
    mcpServerStatus,
    getProjectSessions,
    isProjectStarred,
    onEditingNameChange: setEditingName,
    onToggleProject: toggleProject,
    onProjectSelect: handleProjectSelect,
    onToggleStarProject: toggleStarProject,
    onStartEditingProject: startEditing,
    onCancelEditingProject: cancelEditing,
    onSaveProjectName: (projectName) => {
      void saveProjectName(projectName);
    },
    onDeleteProject: requestProjectDelete,
    onSessionSelect: handleSessionClick,
    onDeleteSession: showDeleteSessionConfirmation,
    onLoadMoreSessions: (project) => {
      void loadMoreSessions(project);
    },
    onNewSession,
    onEditingSessionNameChange: setEditingSessionName,
    onStartEditingSession: (sessionId, initialName) => {
      setEditingSession(sessionId);
      setEditingSessionName(initialName);
    },
    onCancelEditingSession: () => {
      setEditingSession(null);
      setEditingSessionName('');
    },
    onSaveEditingSession: (projectName: string, sessionId: string, summary: string, provider: SessionProvider) => {
      void updateSessionSummary(projectName, sessionId, summary, provider);
    },
    t,
  };

  return (
    <>
      <SidebarModals
        projects={projects}
        showSettings={showSettings}
        settingsInitialTab={settingsInitialTab}
        onCloseSettings={onCloseSettings}
        showNewProject={showNewProject}
        onCloseNewProject={() => setShowNewProject(false)}
        onProjectCreated={handleProjectCreated}
        deleteConfirmation={deleteConfirmation}
        onCancelDeleteProject={() => setDeleteConfirmation(null)}
        onConfirmDeleteProject={confirmDeleteProject}
        sessionDeleteConfirmation={sessionDeleteConfirmation}
        onCancelDeleteSession={() => setSessionDeleteConfirmation(null)}
        onConfirmDeleteSession={confirmDeleteSession}
        showVersionModal={showVersionModal}
        onCloseVersionModal={() => setShowVersionModal(false)}
        releaseInfo={releaseInfo}
        currentVersion={currentVersion}
        latestVersion={latestVersion}
        installMode={installMode}
        t={t}
      />

      {isSidebarCollapsed ? (
        <SidebarCollapsed
          onExpand={handleExpandSidebar}
          onShowSettings={onShowSettings}
          updateAvailable={updateAvailable}
          onShowVersionModal={() => setShowVersionModal(true)}
          t={t}
        />
      ) : (
        <>
          <SidebarContent
            isPWA={isPWA}
            isMobile={isMobile}
            isLoading={isLoading}
            projects={projects}
            searchFilter={searchFilter}
            onSearchFilterChange={setSearchFilter}
            onClearSearchFilter={() => setSearchFilter('')}
            searchMode={searchMode}
            onSearchModeChange={(mode: 'projects' | 'conversations') => {
              setSearchMode(mode);
              if (mode === 'projects') clearConversationResults();
            }}
            conversationResults={conversationResults}
            isSearching={isSearching}
            searchProgress={searchProgress}
            onConversationResultClick={(projectName: string, sessionId: string, provider: string, messageTimestamp?: string | null, messageSnippet?: string | null) => {
              const resolvedProvider = (provider || 'claude') as SessionProvider;
              const project = projects.find(p => p.name === projectName);
              const searchTarget = { __searchTargetTimestamp: messageTimestamp || null, __searchTargetSnippet: messageSnippet || null };
              const sessionObj = {
                id: sessionId,
                __provider: resolvedProvider,
                __projectName: projectName,
                ...searchTarget,
              };
              if (project) {
                handleProjectSelect(project);
                const sessions = getProjectSessions(project);
                const existing = sessions.find(s => s.id === sessionId);
                if (existing) {
                  handleSessionClick({ ...existing, ...searchTarget }, projectName);
                } else {
                  handleSessionClick(sessionObj, projectName);
                }
              } else {
                handleSessionClick(sessionObj, projectName);
              }
            }}
            onRefresh={() => {
              void refreshProjects();
            }}
            isRefreshing={isRefreshing}
            onCreateProject={() => setShowNewProject(true)}
            onCollapseSidebar={handleCollapseSidebar}
            updateAvailable={updateAvailable}
            releaseInfo={releaseInfo}
            latestVersion={latestVersion}
            onShowVersionModal={() => setShowVersionModal(true)}
            onShowSettings={onShowSettings}
            projectListProps={projectListProps}
            t={t}
          />
        </>
      )}

    </>
  );
}

export default Sidebar;
