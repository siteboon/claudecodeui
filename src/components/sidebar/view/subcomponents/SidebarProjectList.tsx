import { useEffect, useMemo } from 'react';
import type { TFunction } from 'i18next';
import type { LoadingProgress, Project, ProjectSession, SessionProvider } from '../../../../types/app';
import type {
  LoadingSessionsByProject,
  MCPServerStatus,
  SessionWithProvider,
} from '../../types/types';
import SidebarProjectItem from './SidebarProjectItem';
import SidebarProjectsState from './SidebarProjectsState';
import SidebarWorktreeItem from './SidebarWorktreeItem';

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
  onNewWorktree?: (project: Project) => void;
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
  onNewWorktree,
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

  /**
   * Group worktree projects under their main repo.
   * Each entry is either:
   *   - A plain project (non-worktree, or worktree whose main repo isn't in the list)
   *   - A main-repo project that has linked worktrees attached
   */
  const groupedProjects = useMemo(() => {
    // Build a fast lookup: fullPath -> project
    const byPath = new Map<string, Project>(
      filteredProjects.map(p => [p.fullPath, p])
    );

    const worktreesByMain = new Map<string, Project[]>();
    const linked = new Set<string>();

    for (const p of filteredProjects) {
      if (p.isWorktree && p.mainRepoPath) {
        const mainProject = byPath.get(p.mainRepoPath);
        if (mainProject) {
          const bucket = worktreesByMain.get(mainProject.name) ?? [];
          bucket.push(p);
          worktreesByMain.set(mainProject.name, bucket);
          linked.add(p.name);
        }
      }
    }

    return filteredProjects
      .filter(p => !linked.has(p.name))
      .map(p => ({ project: p, worktrees: worktreesByMain.get(p.name) ?? [] }));
  }, [filteredProjects]);

  const sharedItemProps = {
    selectedProject,
    selectedSession,
    editingProject,
    editingName,
    currentTime,
    editingSession,
    editingSessionName,
    tasksEnabled,
    mcpServerStatus,
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
    onNewWorktree,
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
        : groupedProjects.map(({ project, worktrees }) => (
            <div key={project.name}>
              <SidebarProjectItem
                project={project}
                isExpanded={expandedProjects.has(project.name)}
                isDeleting={deletingProjects.has(project.name)}
                isStarred={isProjectStarred(project.name)}
                sessions={getProjectSessions(project)}
                initialSessionsLoaded={initialSessionsLoaded.has(project.name)}
                isLoadingSessions={Boolean(loadingSessions[project.name])}
                {...sharedItemProps}
              />
              {worktrees.map(wt => (
                <SidebarWorktreeItem
                  key={wt.name}
                  project={wt}
                  isExpanded={expandedProjects.has(wt.name)}
                  isDeleting={deletingProjects.has(wt.name)}
                  sessions={getProjectSessions(wt)}
                  initialSessionsLoaded={initialSessionsLoaded.has(wt.name)}
                  isLoadingSessions={Boolean(loadingSessions[wt.name])}
                  {...sharedItemProps}
                />
              ))}
            </div>
          ))}
    </div>
  );
}
