import SidebarFooter from './SidebarFooter';
import { useSidebarSettings } from '@/components/refactored/sidebar/hooks/useSidebarSettings';
import { useSidebarModals } from '@/components/refactored/sidebar/hooks/useSidebarModals';
import { useWorkspaces } from '@/components/refactored/sidebar/hooks/useWorkspaces';
import SidebarHeader from '@/components/refactored/sidebar/view/SidebarHeader';
import { SidebarDeleteModals } from '@/components/refactored/sidebar/view/SidebarDeleteModals';
import { SidebarWorkspaceList } from '@/components/refactored/sidebar/view/SidebarWorkspaceList';
import { SidebarCollapsed } from '@/components/refactored/sidebar/view/SidebarCollapsed';
import { cn } from '@/lib/utils';
import ProjectCreationWizard from '@/components/project-creation-wizard';
import VersionUpgradeModal from '@/components/version-upgrade/view';
import Settings from '@/components/settings/view/Settings';

export function Sidebar() {
  const { isCollapsed, toggleCollapse, setCollapsed } = useSidebarSettings();
  const {
    workspaces,
    starredWorkspaces,
    unstarredWorkspaces,
    isRefreshing,
    refreshWorkspaces,
    searchMode,
    setSearchMode,
    searchFilter,
    setSearchFilter,
    selectedSessionId,
    expandedWorkspaces,
    toggleWorkspace,
    openSession,
    openNewSession,
    editingWorkspacePath,
    editingWorkspaceName,
    isSavingWorkspaceName,
    editingSessionId,
    editingSessionName,
    isSavingSessionName,
    setEditingWorkspaceName,
    setEditingSessionName,
    startWorkspaceRename,
    cancelWorkspaceRename,
    saveWorkspaceRename,
    startSessionRename,
    cancelSessionRename,
    saveSessionRename,
    toggleWorkspaceStar,
    workspaceDeleteTarget,
    sessionDeleteTarget,
    requestWorkspaceDelete,
    cancelWorkspaceDelete,
    confirmWorkspaceDelete,
    requestSessionDelete,
    cancelSessionDelete,
    confirmSessionDelete,
  } = useWorkspaces();

  const {
    showNewProject,
    openNewProject,
    closeNewProject,
    showSettingsModal,
    openSettingsModal,
    closeSettingsModal,
    showVersionModal,
    openVersionModal,
    closeVersionModal,
  } = useSidebarModals();

  const handleSessionDeleteRequest = (workspacePath: string, sessionId: string) => {
    const workspace = workspaces.find(
      (workspaceItem) => workspaceItem.workspaceOriginalPath === workspacePath,
    );
    const session = workspace?.sessions.find((item) => item.sessionId === sessionId);
    if (!workspace || !session) {
      return;
    }

    requestSessionDelete(workspacePath, session);
  };

  return (
    <>
      <>
        {/* Mobile Backdrop Overlay - allows tapping outside to close */}
        {!isCollapsed && (
          <div
            className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm md:hidden"
            onClick={() => setCollapsed(true)}
          />
        )}

        <aside
          className={cn(
            "flex h-full min-h-0 flex-col overflow-hidden border-r border-border bg-background/80 backdrop-blur-sm transition-all duration-300",
            "fixed inset-y-0 left-0 z-50 md:relative md:z-0", // Make it fixed drawer on mobile, relative on desktop
            isCollapsed
              ? "-translate-x-full md:translate-x-0 md:w-0 md:opacity-0 md:overflow-hidden md:border-none" // Hide fully on mobile if collapsed
              : "translate-x-0 w-[85vw] sm:w-80 md:w-72 opacity-100"
          )}
        >
          <SidebarHeader
            isCollapsed={isCollapsed}
            onToggleCollapse={toggleCollapse}
            isRefreshing={isRefreshing}
            onRefresh={refreshWorkspaces}
            onNewProject={openNewProject}
            searchMode={searchMode}
            onSearchModeChange={setSearchMode}
            searchFilter={searchFilter}
            onSearchFilterChange={setSearchFilter}
          />
          {!isCollapsed && (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                <SidebarWorkspaceList
                  workspacesCount={workspaces.length}
                  searchFilter={searchFilter}
                  starredWorkspaces={starredWorkspaces}
                  unstarredWorkspaces={unstarredWorkspaces}
                  expandedWorkspaces={expandedWorkspaces}
                  selectedSessionId={selectedSessionId}
                  editingWorkspacePath={editingWorkspacePath}
                  editingWorkspaceName={editingWorkspaceName}
                  isSavingWorkspaceName={isSavingWorkspaceName}
                  editingSessionId={editingSessionId}
                  editingSessionName={editingSessionName}
                  isSavingSessionName={isSavingSessionName}
                  onEditingWorkspaceNameChange={setEditingWorkspaceName}
                  onEditingSessionNameChange={setEditingSessionName}
                  onToggleWorkspace={toggleWorkspace}
                  onToggleWorkspaceStar={toggleWorkspaceStar}
                  onStartWorkspaceRename={startWorkspaceRename}
                  onCancelWorkspaceRename={cancelWorkspaceRename}
                  onSaveWorkspaceRename={saveWorkspaceRename}
                  onStartSessionRename={startSessionRename}
                  onCancelSessionRename={cancelSessionRename}
                  onSaveSessionRename={saveSessionRename}
                  onDeleteWorkspace={requestWorkspaceDelete}
                  onSessionSelect={openSession}
                  onSessionDelete={handleSessionDeleteRequest}
                  onNewSession={openNewSession}
                />
              </div>
              <SidebarFooter
                onOpenSettings={openSettingsModal}
                onOpenVersionModal={openVersionModal}
              />
            </div>
          )}
        </aside>

        {isCollapsed && (
          <aside className="fixed inset-y-0 left-0 z-40 h-full border-r border-border md:relative">
            <SidebarCollapsed
              onExpand={() => setCollapsed(false)}
              onShowSettings={openSettingsModal}
              onShowVersionModal={openVersionModal}
            />
          </aside>
        )}
      </>

      {/* MODALS */}
      {showNewProject && (
        <ProjectCreationWizard
          onClose={closeNewProject}
          onProjectCreated={refreshWorkspaces}
        />
      )}

      <SidebarDeleteModals
        workspaceDeleteTarget={workspaceDeleteTarget}
        sessionDeleteTarget={sessionDeleteTarget}
        onCancelWorkspaceDelete={cancelWorkspaceDelete}
        onConfirmWorkspaceDelete={confirmWorkspaceDelete}
        onCancelSessionDelete={cancelSessionDelete}
        onConfirmSessionDelete={confirmSessionDelete}
      />
      <VersionUpgradeModal isOpen={showVersionModal} onClose={closeVersionModal} />
      <Settings
        isOpen={showSettingsModal}
        onClose={closeSettingsModal}
        initialTab="agents"
      />
    </>
  );
}
