import { useEffect, useMemo } from 'react';
import type { TFunction } from 'i18next';
import type { LoadingProgress, Project, ProjectSession, SessionProvider } from '../../../../types/app';
import type {
  LoadingSessionsByProject,
  MCPServerStatus,
  SessionWithProvider,
} from '../../types/types';
import { groupProjectsByRepo, isRepoGroup } from '../../utils/utils';
import SidebarProjectItem from './SidebarProjectItem';
import SidebarProjectsState from './SidebarProjectsState';
import SidebarRepoGroup from './SidebarRepoGroup';

export type SidebarProjectListProps = {
  projects: Project[];
  filteredProjects: Project[];
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  isLoading: boolean;
  loadingProgress: LoadingProgress | null;
  expandedProjects: Set<string>;
  editingProject: string | null;
  editingName: string;
  loadingSessions: LoadingSessionsByProject;
  initialSessionsLoaded: Set<string>;
  currentTime: Date;
  editingSession: string | null;
  editingSessionName: string;
  deletingProjects: Set<string>;
  tasksEnabled: boolean;
  mcpServerStatus: MCPServerStatus;
  getProjectSessions: (project: Project) => SessionWithProvider[];
  isProjectStarred: (projectName: string) => boolean;
  onEditingNameChange: (value: string) => void;
  onToggleProject: (projectName: string) => void;
  onProjectSelect: (project: Project) => void;
  onToggleStarProject: (projectName: string) => void;
  onStartEditingProject: (project: Project) => void;
  onCancelEditingProject: () => void;
  onSaveProjectName: (projectName: string) => void;
  onDeleteProject: (project: Project) => void;
  onSessionSelect: (session: SessionWithProvider, projectName: string) => void;
  onDeleteSession: (
    projectName: string,
    sessionId: string,
    sessionTitle: string,
    provider: SessionProvider,
  ) => void;
  onLoadMoreSessions: (project: Project) => void;
  onNewSession: (project: Project) => void;
  onEditingSessionNameChange: (value: string) => void;
  onStartEditingSession: (sessionId: string, initialName: string) => void;
  onCancelEditingSession: () => void;
  onSaveEditingSession: (projectName: string, sessionId: string, summary: string, provider: SessionProvider) => void;
  t: TFunction;
};

export default function SidebarProjectList({
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
  onEditingNameChange,
  onToggleProject,
  onProjectSelect,
  onToggleStarProject,
  onStartEditingProject,
  onCancelEditingProject,
  onSaveProjectName,
  onDeleteProject,
  onSessionSelect,
  onDeleteSession,
  onLoadMoreSessions,
  onNewSession,
  onEditingSessionNameChange,
  onStartEditingSession,
  onCancelEditingSession,
  onSaveEditingSession,
  t,
}: SidebarProjectListProps) {
  const state = (
    <SidebarProjectsState
      isLoading={isLoading}
      loadingProgress={loadingProgress}
      projectsCount={projects.length}
      filteredProjectsCount={filteredProjects.length}
      t={t}
    />
  );

  useEffect(() => {
    let baseTitle = 'CloudCLI UI';
    const displayName = selectedProject?.displayName?.trim();
    if (displayName) {
      baseTitle = `${displayName} - ${baseTitle}`;
    }
    document.title = baseTitle;
  }, [selectedProject]);

  const showProjects = !isLoading && projects.length > 0 && filteredProjects.length > 0;

  const groupedItems = useMemo(
    () => groupProjectsByRepo(filteredProjects),
    [filteredProjects],
  );

  const sharedProps = {
    selectedProject,
    selectedSession,
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
    onEditingNameChange,
    onToggleProject,
    onProjectSelect,
    onToggleStarProject,
    onStartEditingProject,
    onCancelEditingProject,
    onSaveProjectName,
    onDeleteProject,
    onSessionSelect,
    onDeleteSession,
    onLoadMoreSessions,
    onNewSession,
    onEditingSessionNameChange,
    onStartEditingSession,
    onCancelEditingSession,
    onSaveEditingSession,
    t,
  };

  return (
    <div className="pb-safe-area-inset-bottom md:space-y-1">
      {!showProjects
        ? state
        : groupedItems.map((item) =>
            isRepoGroup(item) ? (
              <SidebarRepoGroup
                key={`repo-group:${item.repoRoot}`}
                group={item}
                {...sharedProps}
              />
            ) : (
              <SidebarProjectItem
                key={item.name}
                project={item}
                selectedProject={selectedProject}
                selectedSession={selectedSession}
                isExpanded={expandedProjects.has(item.name)}
                isDeleting={deletingProjects.has(item.name)}
                isStarred={isProjectStarred(item.name)}
                editingProject={editingProject}
                editingName={editingName}
                sessions={getProjectSessions(item)}
                initialSessionsLoaded={initialSessionsLoaded.has(item.name)}
                isLoadingSessions={Boolean(loadingSessions[item.name])}
                currentTime={currentTime}
                editingSession={editingSession}
                editingSessionName={editingSessionName}
                tasksEnabled={tasksEnabled}
                mcpServerStatus={mcpServerStatus}
                onEditingNameChange={onEditingNameChange}
                onToggleProject={onToggleProject}
                onProjectSelect={onProjectSelect}
                onToggleStarProject={onToggleStarProject}
                onStartEditingProject={onStartEditingProject}
                onCancelEditingProject={onCancelEditingProject}
                onSaveProjectName={onSaveProjectName}
                onDeleteProject={onDeleteProject}
                onSessionSelect={onSessionSelect}
                onDeleteSession={onDeleteSession}
                onLoadMoreSessions={onLoadMoreSessions}
                onNewSession={onNewSession}
                onEditingSessionNameChange={onEditingSessionNameChange}
                onStartEditingSession={onStartEditingSession}
                onCancelEditingSession={onCancelEditingSession}
                onSaveEditingSession={onSaveEditingSession}
                t={t}
              />
            ),
          )}
    </div>
  );
}
