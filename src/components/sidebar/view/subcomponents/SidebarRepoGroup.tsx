import { useMemo, useState } from 'react';
import { Archive, ChevronDown, ChevronRight, GitFork, Plus } from 'lucide-react';
import type { TFunction } from 'i18next';
import { cn } from '../../../../lib/utils';
import type { Project, ProjectSession, SessionProvider } from '../../../../types/app';
import type {
  LoadingSessionsByProject,
  MCPServerStatus,
  RepoGroup,
  SessionWithProvider,
} from '../../types/types';
import SidebarProjectItem from './SidebarProjectItem';

const MAX_VISIBLE_WORKTREES = 5;

type SidebarRepoGroupProps = {
  group: RepoGroup;
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
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

export default function SidebarRepoGroup({
  group,
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
}: SidebarRepoGroupProps) {
  const [isGroupExpanded, setIsGroupExpanded] = useState(true);
  const [showAllWorktrees, setShowAllWorktrees] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  const hasSelectedChild = group.projects.some((p) => p.name === selectedProject?.name);
  const mainProject = useMemo(
    () => group.projects.find((p) => p.isMainWorktree) || group.projects[0],
    [group.projects],
  );

  const { activeProjects, staleProjects } = useMemo(() => {
    const active: Project[] = [];
    const stale: Project[] = [];
    for (const p of group.projects) {
      if (p.isStale) {
        stale.push(p);
      } else {
        active.push(p);
      }
    }
    return { activeProjects: active, staleProjects: stale };
  }, [group.projects]);

  const visibleActive = showAllWorktrees
    ? activeProjects
    : activeProjects.slice(0, MAX_VISIBLE_WORKTREES);
  const hiddenActiveCount = activeProjects.length - visibleActive.length;

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
    onEditingSessionNameChange,
    onStartEditingSession,
    onCancelEditingSession,
    onSaveEditingSession,
    t,
  };

  const renderProjectItem = (project: Project) => (
    <SidebarProjectItem
      key={project.name}
      project={project}
      isExpanded={expandedProjects.has(project.name)}
      isDeleting={deletingProjects.has(project.name)}
      isStarred={isProjectStarred(project.name)}
      sessions={getProjectSessions(project)}
      initialSessionsLoaded={initialSessionsLoaded.has(project.name)}
      isLoadingSessions={Boolean(loadingSessions[project.name])}
      {...sharedItemProps}
    />
  );

  return (
    <div className="md:space-y-0.5">
      {/* Repo group header */}
      <div
        className={cn(
          'group flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/50',
          hasSelectedChild && 'text-foreground',
        )}
        onClick={() => setIsGroupExpanded((prev) => !prev)}
        title={`${t('projects.repoGroup', { defaultValue: 'Repository' })}: ${group.repoRoot}`}
      >
        {isGroupExpanded ? (
          <ChevronDown className="h-3 w-3 shrink-0" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0" />
        )}
        <GitFork className="h-3 w-3 shrink-0 opacity-60" />
        <span className="truncate">{group.displayName}</span>
        <button
          className="ml-auto shrink-0 rounded p-0.5 opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100 md:opacity-0"
          onClick={(e) => {
            e.stopPropagation();
            onNewSession(mainProject);
          }}
          title={t('projects.newGroupSession', {
            defaultValue: 'New session in {{name}}',
            name: mainProject.displayName,
          })}
        >
          <Plus className="h-3 w-3" />
        </button>
        <span className="shrink-0 text-[10px] opacity-50">
          {activeProjects.length}
        </span>
      </div>

      {/* Child projects (indented) */}
      {isGroupExpanded && (
        <div className="ml-2 border-l border-border/40 pl-1">
          {/* Active worktrees */}
          {visibleActive.map(renderProjectItem)}

          {/* "Show N more" button */}
          {hiddenActiveCount > 0 && (
            <button
              className="w-full rounded-md px-2 py-1 text-left text-[11px] text-muted-foreground transition-colors hover:bg-muted/50"
              onClick={() => setShowAllWorktrees(true)}
            >
              {t('projects.showMoreWorktrees', {
                defaultValue: 'Show {{count}} more...',
                count: hiddenActiveCount,
              })}
            </button>
          )}

          {/* Archived / stale worktrees */}
          {staleProjects.length > 0 && (
            <>
              <button
                className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-muted-foreground/60 transition-colors hover:bg-muted/50"
                onClick={() => setShowArchived((prev) => !prev)}
              >
                {showArchived ? (
                  <ChevronDown className="h-2.5 w-2.5 shrink-0" />
                ) : (
                  <ChevronRight className="h-2.5 w-2.5 shrink-0" />
                )}
                <Archive className="h-2.5 w-2.5 shrink-0" />
                <span>
                  {staleProjects.length} {t('projects.archived', { defaultValue: 'archived' })}
                </span>
              </button>
              {showArchived && (
                <div className="opacity-50">
                  {staleProjects.map(renderProjectItem)}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
