import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDeviceSettings } from '../../../hooks/useDeviceSettings';
import { useVersionCheck } from '../../../hooks/useVersionCheck';
import { useUiPreferences } from '../../../hooks/useUiPreferences';
import { useSidebarController } from '../hooks/useSidebarController';
import { useTaskMaster } from '../../../contexts/TaskMasterContext';
import { useSessionStatusMap } from '../../../hooks/useSessionStatusMap';
import { useFlatSessionList, type FlatSession } from '../../../hooks/useFlatSessionList';
import { useProjectRail } from '../../project-rail/hooks/useProjectRail';
import { useProjectColors } from '../../../hooks/useProjectColors';
import { useHiddenSessions } from '../../../hooks/useHiddenSessions';
import { getProjectColor } from '../../project-rail/utils/projectColors';
import type { Project } from '../../../types/app';
import type { MCPServerStatus, SidebarProps } from '../types/types';
import ProjectRail from '../../project-rail/view/ProjectRail';
import SidebarCollapsed from './subcomponents/SidebarCollapsed';
import SidebarModals from './subcomponents/SidebarModals';
import CommandBar, { type CommandBarHandle } from './subcomponents/CommandBar';
import FlatSessionList from './subcomponents/FlatSessionList';
import SidebarFooterV4 from './subcomponents/SidebarFooterV4';
import MobileProjectFilter from './subcomponents/MobileProjectFilter';

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
  onRefresh,
  onShowSettings,
  showSettings,
  settingsInitialTab,
  onCloseSettings,
  isMobile,
  activeSessions,
  processingSessions,
}: SidebarProps) {
  const { t } = useTranslation(['sidebar', 'common']);
  const { isPWA } = useDeviceSettings({ trackMobile: false });
  const { updateAvailable, latestVersion, currentVersion, releaseInfo, installMode } = useVersionCheck(
    'startino',
    'claudecodeui',
  );
  const { preferences, setPreference } = useUiPreferences();
  const { sidebarVisible } = preferences;
  const { setCurrentProject } = useTaskMaster() as TaskMasterSidebarContext;

  const [activeProjectFilter, setActiveProjectFilter] = useState<string | null>(null);
  const { getColor, setColor } = useProjectColors();
  const { toggleHidden, isHidden } = useHiddenSessions();

  const {
    isSidebarCollapsed,
    showNewProject,
    currentTime,
    searchFilter,
    setSearchFilter,
    additionalSessions,
    deleteConfirmation,
    sessionDeleteConfirmation,
    showVersionModal,
    handleSessionClick,
    handleProjectSelect,
    confirmDeleteSession,
    confirmDeleteProject,
    expandSidebar,
    setShowNewProject,
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

  const statusMap = useSessionStatusMap({ activeSessions, processingSessions });

  const { railItems, totalAttentionCount } = useProjectRail({
    projects,
    statusMap,
    additionalSessions,
    excludeSessionId: selectedSession?.id ?? null,
  });

  const flatSessions = useFlatSessionList({
    projects,
    activeProjectFilter,
    searchFilter,
    statusMap,
    additionalSessions,
  });

  const openProjectName = useMemo<string | null>(() => {
    const fromSession = (selectedSession?.__projectName as string | undefined) ?? null;
    if (fromSession) return fromSession;
    if (selectedProject) return selectedProject.name;
    return activeProjectFilter;
  }, [activeProjectFilter, selectedProject, selectedSession]);

  const openColor = useMemo(
    () => getProjectColor(getColor(openProjectName)),
    [getColor, openProjectName],
  );

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    root.style.setProperty('--project-accent', openColor.hex);
    root.style.setProperty('--project-accent-foreground', openColor.fg);
  }, [openColor.fg, openColor.hex]);

  const activeProjectName = useMemo(() => {
    if (activeProjectFilter) {
      const p = projects.find((pp) => pp.name === activeProjectFilter);
      return p ? p.displayName || p.name : 'project';
    }
    if (selectedProject) return selectedProject.displayName || selectedProject.name;
    return projects[0]?.displayName || projects[0]?.name || 'project';
  }, [activeProjectFilter, projects, selectedProject]);

  const targetProject = useMemo(() => {
    if (activeProjectFilter) {
      return projects.find((p) => p.name === activeProjectFilter) ?? null;
    }
    return selectedProject ?? projects[0] ?? null;
  }, [activeProjectFilter, projects, selectedProject]);

  const commandBarRef = useRef<CommandBarHandle>(null);

  const handleCreateSession = () => {
    if (!targetProject) return;
    handleProjectSelect(targetProject);
    onNewSession(targetProject);
  };

  const handleFlatSessionSelect = (session: FlatSession) => {
    const project = projects.find((p) => p.name === session.__projectName);
    if (project) {
      handleProjectSelect(project);
    }
    handleSessionClick(session, session.__projectName);
  };

  const handleProjectCreated = () => {
    if (window.refreshProjects) {
      void window.refreshProjects();
      return;
    }
    window.location.reload();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inInput = !!target && (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      );
      const mod = e.metaKey || e.ctrlKey;

      if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        commandBarRef.current?.focus();
        return;
      }

      if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        handleCreateSession();
        return;
      }

      if (inInput) return;

      if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'w') {
        if (!selectedSession) return;
        e.preventDefault();
        toggleHidden(selectedSession.id);
        return;
      }

      if (mod && !e.shiftKey && !e.altKey && /^[1-8]$/.test(e.key)) {
        e.preventDefault();
        const idx = parseInt(e.key, 10) - 1;
        const target = flatSessions[idx];
        if (target) handleFlatSessionSelect(target);
        return;
      }

      if (e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey && e.key === '`') {
        e.preventDefault();
        setActiveProjectFilter(null);
        return;
      }

      if (e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey && /^[1-6]$/.test(e.key)) {
        e.preventDefault();
        const idx = parseInt(e.key, 10) - 1;
        const item = railItems[idx];
        if (item) setActiveProjectFilter(item.name);
        return;
      }
    };

    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flatSessions, railItems, selectedSession, selectedProject]);

  const userName = useMemo(() => {
    if (typeof window === 'undefined') return 'user';
    const host = window.location?.hostname ?? '';
    return host.split('.')[0] || 'user';
  }, []);

  const body = (
    <div
      className={`flex h-full ${isMobile ? 'flex-col' : 'flex-row'} bg-background/80 backdrop-blur-sm md:select-none`}
    >
      {!isMobile && (
        <ProjectRail
          railItems={railItems}
          activeProjectFilter={activeProjectFilter}
          totalAttentionCount={totalAttentionCount}
          onProjectFilter={setActiveProjectFilter}
          getColor={getColor}
          setColor={setColor}
        />
      )}
      <div className={`flex min-h-0 flex-1 flex-col ${!isMobile ? 'w-72' : ''}`}>
        {isMobile && railItems.length > 0 && (
          <MobileProjectFilter
            items={railItems}
            activeFilter={activeProjectFilter}
            onFilter={setActiveProjectFilter}
            getColor={getColor}
          />
        )}
        <CommandBar
          ref={commandBarRef}
          searchFilter={searchFilter}
          onSearchFilterChange={setSearchFilter}
          onCreateSession={handleCreateSession}
          activeProjectName={activeProjectName}
          resultCount={flatSessions.length}
        />
        {isLoading && flatSessions.length === 0 ? (
          <div className="flex flex-1 items-center justify-center px-4 py-8 text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <div className="h-3.5 w-3.5 animate-spin rounded-full border-[1.5px] border-muted-foreground/40 border-t-primary" />
              <span>Loading…</span>
            </div>
          </div>
        ) : (
          <FlatSessionList
            sessions={flatSessions}
            selectedSessionId={selectedSession?.id ?? null}
            currentTime={currentTime}
            searchActive={searchFilter.trim().length > 0}
            isHidden={isHidden}
            onSessionSelect={handleFlatSessionSelect}
            onToggleHidden={toggleHidden}
            activeProjectName={activeProjectName}
            onCreateSession={handleCreateSession}
          />
        )}
        <SidebarFooterV4
          userName={userName}
          sessionCount={flatSessions.length}
          onShowSettings={onShowSettings}
        />
      </div>
    </div>
  );

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
          onExpand={expandSidebar}
          onShowSettings={onShowSettings}
          updateAvailable={updateAvailable}
          onShowVersionModal={() => setShowVersionModal(true)}
          t={t}
        />
      ) : (
        body
      )}
    </>
  );
}

export default Sidebar;
