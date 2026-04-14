/**
 * SidebarWorktreeItem
 *
 * Renders a git linked-worktree project as an indented sub-item beneath its
 * main repo entry in the sidebar.  The appearance intentionally mirrors
 * SidebarProjectItem but adds:
 *   - Left indentation + a subtle connector line
 *   - A GitBranch icon + branch name badge instead of a folder icon
 *   - No star / rename controls (worktree identity is managed by git, not by
 *     the user via the UI)
 */

import { ChevronDown, ChevronRight, GitBranch, Trash2 } from 'lucide-react';
import type { TFunction } from 'i18next';
import { cn } from '../../../../lib/utils';
import type { Project, ProjectSession, SessionProvider } from '../../../../types/app';
import type { MCPServerStatus, SessionWithProvider } from '../../types/types';
import SidebarProjectSessions from './SidebarProjectSessions';

type SidebarWorktreeItemProps = {
  project: Project;
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  isExpanded: boolean;
  isDeleting: boolean;
  sessions: SessionWithProvider[];
  initialSessionsLoaded: boolean;
  isLoadingSessions: boolean;
  currentTime: Date;
  editingSession: string | null;
  editingSessionName: string;
  mcpServerStatus: MCPServerStatus;
  // Unused but forwarded from sharedItemProps — kept so the spread works cleanly
  editingProject: string | null;
  editingName: string;
  tasksEnabled: boolean;
  isStarred?: boolean;
  onEditingNameChange: (name: string) => void;
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
  onSaveEditingSession: (
    projectName: string,
    sessionId: string,
    summary: string,
    provider: SessionProvider,
  ) => void;
  t: TFunction;
};

export default function SidebarWorktreeItem({
  project,
  selectedProject,
  selectedSession,
  isExpanded,
  isDeleting,
  sessions,
  initialSessionsLoaded,
  isLoadingSessions,
  currentTime,
  editingSession,
  editingSessionName,
  onToggleProject,
  onProjectSelect,
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
}: SidebarWorktreeItemProps) {
  const isSelected = selectedProject?.name === project.name;
  const branch = project.worktreeBranch ?? 'worktree';
  const hasMoreSessions = project.sessionMeta?.hasMore === true;
  const sessionCount = sessions.length;
  const sessionCountDisplay = hasMoreSessions && sessionCount >= 5 ? `${sessionCount}+` : `${sessionCount}`;
  const sessionCountLabel = `${sessionCountDisplay} session${sessionCount === 1 ? '' : 's'}`;

  const toggle = () => onToggleProject(project.name);
  const selectAndToggle = () => {
    if (selectedProject?.name !== project.name) {
      onProjectSelect(project);
    }
    toggle();
  };

  return (
    <div className={cn('md:space-y-1', isDeleting && 'opacity-50 pointer-events-none')}>
      {/* ── Desktop ─────────────────────────────────────────────────── */}
      <div className="hidden md:block">
        <div className="relative pl-6">
          {/* Vertical connector line */}
          <span
            className="absolute left-3 top-0 h-full w-px bg-border/50"
            aria-hidden
          />
          {/* Horizontal connector nub */}
          <span
            className="absolute left-3 top-1/2 h-px w-3 bg-border/50"
            aria-hidden
          />

          <div
            className={cn(
              'group flex cursor-pointer items-center justify-between rounded-lg px-2 py-1.5 transition-colors hover:bg-accent/50',
              isSelected && 'bg-primary/5',
            )}
            onClick={selectAndToggle}
          >
            <div className="flex min-w-0 flex-1 items-center gap-2">
              {/* Expand/collapse chevron */}
              {isExpanded ? (
                <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
              )}

              {/* Branch icon */}
              <GitBranch className="h-3.5 w-3.5 shrink-0 text-emerald-500 dark:text-emerald-400" />

              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-1.5">
                  <span
                    className="truncate text-xs font-medium text-foreground"
                    title={branch}
                  >
                    {branch}
                  </span>
                </div>
                <p className="text-[10px] leading-none text-muted-foreground mt-0.5">{sessionCountLabel}</p>
              </div>
            </div>

            {/* Delete button — visible on hover */}
            <div className="hidden shrink-0 items-center gap-1 group-hover:flex">
              <button
                className="flex h-6 w-6 items-center justify-center rounded border border-red-200 bg-red-500/10 opacity-0 transition-opacity group-hover:opacity-100 dark:border-red-800 dark:bg-red-900/30"
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteProject(project);
                }}
                title={t('tooltips.deleteProject')}
              >
                <Trash2 className="h-3 w-3 text-red-600 dark:text-red-400" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Mobile ──────────────────────────────────────────────────── */}
      <div className="md:hidden">
        <div className="pl-4">
          <div
            className={cn(
              'flex items-center gap-2 rounded-lg border border-border/50 bg-card px-3 py-2 mx-3 my-1 active:scale-[0.98] transition-all duration-150',
              isSelected && 'border-primary/20 bg-primary/5',
            )}
            onClick={selectAndToggle}
          >
            <GitBranch className="h-4 w-4 shrink-0 text-emerald-500 dark:text-emerald-400" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">{branch}</p>
              <p className="text-xs text-muted-foreground">{sessionCountLabel}</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Sessions (shared for desktop + mobile) ──────────────────── */}
      {isExpanded && (
        <div className="pl-6">
          <SidebarProjectSessions
            project={project}
            isExpanded={isExpanded}
            sessions={sessions}
            selectedSession={selectedSession}
            initialSessionsLoaded={initialSessionsLoaded}
            isLoadingSessions={isLoadingSessions}
            currentTime={currentTime}
            editingSession={editingSession}
            editingSessionName={editingSessionName}
            onProjectSelect={onProjectSelect}
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
        </div>
      )}
    </div>
  );
}
