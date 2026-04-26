import { useEffect, useMemo } from 'react';
import type { TFunction } from 'i18next';
import type { LoadingProgress, Project, ProjectSession, LLMProvider } from '../../../../types/app';
import type {
  AdditionalSessionsByProject,
  LoadingSessionsByProject,
  MCPServerStatus,
  SessionWithProvider,
} from '../../types/types';
import { groupProjectsByRepo, isRepoGroup } from '../../utils/utils';
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
  editingProject: string | null;
  editingName: string;
  loadingSessions: LoadingSessionsByProject;
  additionalSessions: AdditionalSessionsByProject;
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
    provider: LLMProvider,
  ) => void;
  onLoadMoreSessions: (project: Project) => void;
  onNewSession: (project: Project) => void;
  onEditingSessionNameChange: (value: string) => void;
  onStartEditingSession: (sessionId: string, initialName: string) => void;
  onCancelEditingSession: () => void;
  onSaveEditingSession: (projectName: string, sessionId: string, summary: string, provider: LLMProvider) => void;
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
  additionalSessions,
  currentTime,
  onToggleProject,
  onSessionSelect,
  onNewSession,
  onDeleteProject,
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

  return (
    <div className="pb-safe-area-inset-bottom md:space-y-1.5">
      {!showProjects
        ? state
        : groupedItems.map((item) => {
            const projectsInGroup = isRepoGroup(item) ? item.projects : [item];
            const main = isRepoGroup(item)
              ? (item.projects.find((p) => p.isMainWorktree) ?? item.projects[0])
              : item;
            const linkedWorktrees = isRepoGroup(item)
              ? item.projects.filter((p) => p.name !== main.name)
              : [];

            return (
              <RepoCard
                key={isRepoGroup(item) ? `repo-group:${item.repoRoot}` : item.name}
                projects={projectsInGroup}
                mainProject={main}
                linkedWorktrees={linkedWorktrees}
                isExpanded={expandedProjects.has(main.name)}
                selectedProject={selectedProject}
                selectedSession={selectedSession}
                additionalSessions={additionalSessions}
                currentTime={currentTime}
                onToggle={() => onToggleProject(main.name)}
                onNewSession={onNewSession}
                onSessionSelect={onSessionSelect}
                onDeleteProject={onDeleteProject}
                t={t}
              />
            );
          })}
    </div>
  );
}
