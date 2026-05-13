import { useEffect, useMemo } from 'react';
import type { TFunction } from 'i18next';

import type { LoadingProgress, Project, ProjectSession, LLMProvider } from '../../../../types/app';
import type { MCPServerStatus, SessionWithProvider } from '../../types/types';
import { groupProjectsByRepo } from '../../utils/utils';

import RepoCard from './RepoCard';
import SidebarProjectsState from './SidebarProjectsState';

export type SidebarProjectListProps = {
  projects: Project[];
  filteredProjects: Project[];
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  isLoading: boolean;
  loadingProgress: LoadingProgress | null;
  expandedProjects: Set<string>;
  currentTime: Date;
  editingSession: string | null;
  editingSessionName: string;
  tasksEnabled: boolean;
  mcpServerStatus: MCPServerStatus;
  isProjectStarred: (projectId: string) => boolean;
  onToggleProject: (projectId: string) => void;
  onToggleStarProject: (projectId: string) => void;
  onDeleteProject: (project: Project) => void;
  onDeleteSession: (
    projectId: string,
    sessionId: string,
    sessionTitle: string,
    provider: LLMProvider,
  ) => void;
  onSessionSelect: (session: SessionWithProvider, projectId: string) => void;
  onNewSession: (project: Project) => void;
  onEditingSessionNameChange: (value: string) => void;
  onStartEditingSession: (sessionId: string, initialName: string) => void;
  onCancelEditingSession: () => void;
  onSaveEditingSession: (
    projectId: string,
    sessionId: string,
    summary: string,
    provider: LLMProvider,
  ) => void;
  onLoadMoreSessions?: (projectId: string) => void;
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
  currentTime,
  editingSession,
  editingSessionName,
  tasksEnabled,
  mcpServerStatus,
  isProjectStarred,
  onToggleProject,
  onToggleStarProject,
  onDeleteProject,
  onDeleteSession,
  onSessionSelect,
  onNewSession,
  onEditingSessionNameChange,
  onStartEditingSession,
  onCancelEditingSession,
  onSaveEditingSession,
  onLoadMoreSessions,
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

  const repoBuckets = useMemo(() => groupProjectsByRepo(filteredProjects), [filteredProjects]);

  return (
    <div className="pb-safe-area-inset-bottom md:space-y-1">
      {!showProjects
        ? state
        : repoBuckets.map((bucket) => (
            <RepoCard
              key={bucket.key}
              projects={bucket.projects}
              mainProject={bucket.mainProject}
              linkedWorktrees={bucket.linkedWorktrees}
              isExpanded={expandedProjects.has(bucket.mainProject.projectId)}
              isStarred={isProjectStarred(bucket.mainProject.projectId)}
              selectedProject={selectedProject}
              selectedSession={selectedSession}
              currentTime={currentTime}
              editingSessionId={editingSession}
              editingSessionName={editingSessionName}
              tasksEnabled={tasksEnabled}
              mcpServerStatus={mcpServerStatus}
              onToggle={() => onToggleProject(bucket.mainProject.projectId)}
              onNewSession={onNewSession}
              onSessionSelect={onSessionSelect}
              onDeleteProject={onDeleteProject}
              onDeleteSession={onDeleteSession}
              onToggleStar={onToggleStarProject}
              onEditingSessionNameChange={onEditingSessionNameChange}
              onStartEditingSession={onStartEditingSession}
              onCancelEditingSession={onCancelEditingSession}
              onSaveEditingSession={onSaveEditingSession}
              onLoadMoreSessions={onLoadMoreSessions}
              t={t}
            />
          ))}
    </div>
  );
}
