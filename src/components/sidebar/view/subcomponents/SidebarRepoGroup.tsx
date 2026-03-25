import { useState } from 'react';
import { ChevronDown, ChevronRight, GitFork } from 'lucide-react';
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
  const hasSelectedChild = group.projects.some((p) => p.name === selectedProject?.name);

  return (
    <div className="md:space-y-0.5">
      {/* Repo group header */}
      <div
        className={cn(
          'flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/50',
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
        <span className="ml-auto shrink-0 text-[10px] opacity-50">
          {group.projects.length} {t('projects.worktrees', { defaultValue: 'worktrees' })}
        </span>
      </div>

      {/* Child projects (indented) */}
      {isGroupExpanded && (
        <div className="ml-2 border-l border-border/40 pl-1">
          {group.projects.map((project) => (
            <SidebarProjectItem
              key={project.name}
              project={project}
              selectedProject={selectedProject}
              selectedSession={selectedSession}
              isExpanded={expandedProjects.has(project.name)}
              isDeleting={deletingProjects.has(project.name)}
              isStarred={isProjectStarred(project.name)}
              editingProject={editingProject}
              editingName={editingName}
              sessions={getProjectSessions(project)}
              initialSessionsLoaded={initialSessionsLoaded.has(project.name)}
              isLoadingSessions={Boolean(loadingSessions[project.name])}
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
          ))}
        </div>
      )}
    </div>
  );
}
