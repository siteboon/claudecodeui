import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, FolderTree } from 'lucide-react';

import type { Project, SidebarProjectListProps } from '@/shared/types';
import { getPageTitle } from '@/shared/utils';
import SidebarProjectItem from '@/modules/sidebar/SidebarProjectItem';
import SidebarProjectsState from '@/modules/sidebar/SidebarProjectsState';
import { groupProjectsByBasename } from '@/modules/sidebar/utils/sidebarProjectFormatting';


/** Rendered by SidebarContent to list the filtered projects, delegating each row to SidebarProjectItem. */
export default function SidebarProjectList({
  projects,
  filteredProjects,
  selectedProject,
  selectedSession,
  isLoading,
  loadingProgress,
  isProjectExpanded,
  activeRename,
  initialSessionsLoaded,
  currentTime,
  groupProjectsByName = false,
  searchFilter = '',
  deletingProjects,
  tasksEnabled,
  mcpServerStatus,
  getProjectSessions,
  onLoadMoreSessions,
  loadingMoreProjects,
  activeSessions,
  backgroundSessionIds,
  attentionSessionIds,
  isProjectStarred,
  onRenameDraftChange,
  onToggleProject,
  onProjectSelect,
  onToggleStarProject,
  onStartEditingProject,
  onCancelEditingProject,
  onSaveProjectName,
  onDeleteProject,
  onSessionSelect,
  onDeleteSession,
  onForkSession,
  onNewSession,
  onStartEditingSession,
  onCancelEditingSession,
  onSaveEditingSession,
  t,
}: SidebarProjectListProps) {
  const pageTitle = getPageTitle(selectedProject, selectedSession);
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
    document.title = pageTitle;
  }, [pageTitle]);

  // Visual-only grouping of projects that share the same trailing folder name
  // (the same project reached from different machines/paths when ~/.claude is synced).
  const projectGroups = useMemo(
    () => (groupProjectsByName ? groupProjectsByBasename(filteredProjects) : null),
    [groupProjectsByName, filteredProjects],
  );

  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const toggleGroup = (groupKey: string) => {
    setCollapsedGroups((previous) => {
      const next = new Set(previous);
      if (next.has(groupKey)) {
        next.delete(groupKey);
      } else {
        next.add(groupKey);
      }
      return next;
    });
  };

  const showProjects = !isLoading && projects.length > 0 && filteredProjects.length > 0;

  const renderProjectItem = (project: Project) => {
    // Both renames are resolved here rather than inside the row, so
    // every other row is handed the same scalars on each keystroke and
    // its memo boundary holds.
    const renamingProject =
      activeRename?.target === 'project' && activeRename.id === project.projectId
        ? activeRename
        : null;
    const renamingSession =
      activeRename?.target === 'session' && activeRename.projectId === project.projectId
        ? activeRename
        : null;

    // React key + per-project state lookups all use the DB `projectId`
    // so they remain stable across renames and session changes.
    return (
      <SidebarProjectItem
        key={project.projectId}
        project={project}
        selectedProject={selectedProject}
        selectedSession={selectedSession}
        isExpanded={isProjectExpanded(project.projectId)}
        isDeleting={deletingProjects.has(project.projectId)}
        isStarred={isProjectStarred(project.projectId)}
        isEditing={renamingProject !== null}
        renameDraft={renamingProject?.draft ?? ''}
        sessions={getProjectSessions(project)}
        initialSessionsLoaded={initialSessionsLoaded.has(project.projectId)}
        isLoadingMoreSessions={loadingMoreProjects.has(project.projectId)}
        currentTime={currentTime}
        sessionRenameId={renamingSession?.id ?? null}
        sessionRenameDraft={renamingSession?.draft ?? ''}
        tasksEnabled={tasksEnabled}
        mcpServerStatus={mcpServerStatus}
        onRenameDraftChange={onRenameDraftChange}
        onToggleProject={onToggleProject}
        onProjectSelect={onProjectSelect}
        onToggleStarProject={onToggleStarProject}
        onStartEditingProject={onStartEditingProject}
        onCancelEditingProject={onCancelEditingProject}
        onSaveProjectName={onSaveProjectName}
        onDeleteProject={onDeleteProject}
        onSessionSelect={onSessionSelect}
        onDeleteSession={onDeleteSession}
        onForkSession={onForkSession}
        onLoadMoreSessions={onLoadMoreSessions}
        activeSessions={activeSessions}
        backgroundSessionIds={backgroundSessionIds}
        attentionSessionIds={attentionSessionIds}
        onNewSession={onNewSession}
        onStartEditingSession={onStartEditingSession}
        onCancelEditingSession={onCancelEditingSession}
        onSaveEditingSession={onSaveEditingSession}
        t={t}
      />
    );
  };

  const renderGroupedProjects = () =>
    (projectGroups ?? []).map((group) => {
      if (group.projects.length === 1) {
        return renderProjectItem(group.projects[0]);
      }

      // A search must not hide a match behind a collapsed header: the header
      // would say a project matched without showing which one. The persisted
      // collapsed state is kept, it is only ignored while a filter is active.
      const isCollapsed = collapsedGroups.has(group.key) && searchFilter.trim().length === 0;
      const totalSessions = group.projects.reduce(
        (sum, project) => sum + (project.sessionMeta?.total ?? project.sessions?.length ?? 0),
        0,
      );

      return (
        <div key={`project-group-${group.key}`} className="md:space-y-1">
          <button
            type="button"
            onClick={() => toggleGroup(group.key)}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors hover:bg-accent/50"
            aria-expanded={!isCollapsed}
          >
            {isCollapsed ? (
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            )}
            <FolderTree className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{group.key}</span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {t('projectGroup.locations', { count: group.projects.length })}
              {` · ${totalSessions}`}
            </span>
          </button>
          {!isCollapsed && (
            <div className="ml-3 border-l border-border pl-1 md:space-y-1">
              {group.projects.map((project) => renderProjectItem(project))}
            </div>
          )}
        </div>
      );
    });

  return (
    <div className="pb-safe-area-inset-bottom md:space-y-1">
      {!showProjects
        ? state
        : projectGroups
          ? renderGroupedProjects()
          : filteredProjects.map((project) => renderProjectItem(project))}
    </div>
  );
}
