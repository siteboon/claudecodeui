import { useEffect, useMemo, useState } from 'react';
import {
  DndContext,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { ChevronDown, ChevronRight, GitBranch, FolderGit2 } from 'lucide-react';

import type { Project } from '../../../types/app';
import { cn } from '../../../lib/utils';
import type { SidebarProjectListProps } from '../view/subcomponents/SidebarProjectList';
import SidebarProjectsState from '../view/subcomponents/SidebarProjectsState';

import SidebarTopicGroup from './SidebarTopicGroup';
import { useServerTopics } from './useServerTopics';

const FALLBACK_GROUP = '__uncategorized__';
const REPO_COLLAPSED_KEY = 'dispatch.sidebar.repoCollapsed.v1';

function readCollapsedSet(): Set<string> {
  try {
    const raw = localStorage.getItem(REPO_COLLAPSED_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed as string[]);
  } catch {
    return new Set();
  }
}

function writeCollapsedSet(set: Set<string>) {
  try {
    localStorage.setItem(REPO_COLLAPSED_KEY, JSON.stringify([...set]));
  } catch {
    // non-fatal
  }
}

type RepoGroup = {
  key: string;
  displayName: string;
  projects: Project[];
  hasWorktrees: boolean;
  gitOrigin: string | null;
};

function groupProjects(projects: Project[]): RepoGroup[] {
  const groups = new Map<string, RepoGroup>();
  for (const p of projects) {
    const key = p.repoGroup || FALLBACK_GROUP;
    const displayName =
      p.repoDisplayName ||
      (key === FALLBACK_GROUP ? 'Uncategorized' : key.replace(/^local:/, ''));
    const existing = groups.get(key);
    if (existing) {
      existing.projects.push(p);
      if (p.isWorktree) existing.hasWorktrees = true;
    } else {
      groups.set(key, {
        key,
        displayName,
        projects: [p],
        hasWorktrees: Boolean(p.isWorktree),
        gitOrigin: typeof p.gitOrigin === 'string' ? p.gitOrigin : null,
      });
    }
  }
  const arr = Array.from(groups.values());
  // Stable order: groups with more projects last (they collapse dense
  // repos like Dispatch to the bottom). Uncategorized last.
  arr.sort((a, b) => {
    if (a.key === FALLBACK_GROUP && b.key !== FALLBACK_GROUP) return 1;
    if (b.key === FALLBACK_GROUP && a.key !== FALLBACK_GROUP) return -1;
    return a.displayName.localeCompare(b.displayName);
  });
  return arr;
}

export default function SidebarProjectTree(props: SidebarProjectListProps) {
  const {
    projects,
    filteredProjects,
    isLoading,
    loadingProgress,
    t,
    ...itemProps
  } = props;
  const topicsApi = useServerTopics();
  const [collapsed, setCollapsed] = useState<Set<string>>(() => readCollapsedSet());

  useEffect(() => {
    writeCollapsedSet(collapsed);
  }, [collapsed]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  );

  useEffect(() => {
    let baseTitle = 'CloudCLI UI';
    const displayName = itemProps.selectedProject?.displayName?.trim();
    if (displayName) {
      baseTitle = `${displayName} - ${baseTitle}`;
    }
    document.title = baseTitle;
  }, [itemProps.selectedProject]);

  const repoGroups = useMemo(() => groupProjects(filteredProjects), [filteredProjects]);

  const toggleCollapsed = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;
    const activeData = active.data.current as
      | { type?: string; sessionId?: string; projectName?: string }
      | undefined;
    const overData = over.data.current as
      | { type?: string; topicId?: string | null; projectKey?: string }
      | undefined;
    if (activeData?.type !== 'session' || !activeData.sessionId) return;
    if (overData?.type !== 'topic') return;
    const projectKey = overData.projectKey || activeData.projectName;
    if (!projectKey) return;
    void topicsApi.assignSessionToTopic(
      activeData.sessionId,
      projectKey,
      overData.topicId ?? null,
    );
  };

  const state = (
    <SidebarProjectsState
      isLoading={isLoading}
      loadingProgress={loadingProgress}
      projectsCount={projects.length}
      filteredProjectsCount={filteredProjects.length}
      t={t}
    />
  );

  const showProjects = !isLoading && projects.length > 0 && filteredProjects.length > 0;

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div className="pb-safe-area-inset-bottom md:space-y-1" data-accent="lavender">
        {!showProjects ? (
          state
        ) : (
          repoGroups.map((group) => {
            const isCollapsed = collapsed.has(group.key);
            const showHeader = group.projects.length > 1 || group.hasWorktrees;
            const groupId = `repo-group-${group.key}`;
            return (
              <section key={group.key} aria-labelledby={groupId} className="md:space-y-1">
                {showHeader && (
                  <button
                    id={groupId}
                    type="button"
                    onClick={() => toggleCollapsed(group.key)}
                    aria-expanded={!isCollapsed}
                    className={cn(
                      'flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground min-h-[44px] md:px-2',
                    )}
                  >
                    {isCollapsed ? (
                      <ChevronRight className="h-3.5 w-3.5 flex-shrink-0" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5 flex-shrink-0" />
                    )}
                    {group.gitOrigin ? (
                      <FolderGit2 className="h-3.5 w-3.5 flex-shrink-0 text-[color:var(--midnight-lavender)]" />
                    ) : (
                      <GitBranch className="h-3.5 w-3.5 flex-shrink-0" />
                    )}
                    <span className="truncate">{group.displayName}</span>
                    <span className="badge ml-auto text-[10px] normal-case tracking-normal">
                      {group.projects.length}
                    </span>
                  </button>
                )}
                {!isCollapsed &&
                  group.projects.map((project) => (
                    <SidebarTopicGroup
                      key={project.name}
                      project={project}
                      topicsApi={topicsApi}
                      t={t}
                      selectedProject={itemProps.selectedProject}
                      selectedSession={itemProps.selectedSession}
                      isExpanded={itemProps.expandedProjects.has(project.name)}
                      isDeleting={itemProps.deletingProjects.has(project.name)}
                      isStarred={itemProps.isProjectStarred(project.name)}
                      editingProject={itemProps.editingProject}
                      editingName={itemProps.editingName}
                      sessions={itemProps.getProjectSessions(project)}
                      initialSessionsLoaded={itemProps.initialSessionsLoaded.has(project.name)}
                      isLoadingSessions={Boolean(itemProps.loadingSessions[project.name])}
                      currentTime={itemProps.currentTime}
                      editingSession={itemProps.editingSession}
                      editingSessionName={itemProps.editingSessionName}
                      tasksEnabled={itemProps.tasksEnabled}
                      mcpServerStatus={itemProps.mcpServerStatus}
                      onEditingNameChange={itemProps.onEditingNameChange}
                      onToggleProject={itemProps.onToggleProject}
                      onProjectSelect={itemProps.onProjectSelect}
                      onToggleStarProject={itemProps.onToggleStarProject}
                      onStartEditingProject={itemProps.onStartEditingProject}
                      onCancelEditingProject={itemProps.onCancelEditingProject}
                      onSaveProjectName={itemProps.onSaveProjectName}
                      onDeleteProject={itemProps.onDeleteProject}
                      onSessionSelect={itemProps.onSessionSelect}
                      onDeleteSession={itemProps.onDeleteSession}
                      onLoadMoreSessions={itemProps.onLoadMoreSessions}
                      onNewSession={itemProps.onNewSession}
                      onEditingSessionNameChange={itemProps.onEditingSessionNameChange}
                      onStartEditingSession={itemProps.onStartEditingSession}
                      onCancelEditingSession={itemProps.onCancelEditingSession}
                      onSaveEditingSession={itemProps.onSaveEditingSession}
                    />
                  ))}
              </section>
            );
          })
        )}
      </div>
    </DndContext>
  );
}
