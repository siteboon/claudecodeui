import { useMemo, useState } from 'react';
import { Archive, ChevronDown, ChevronRight, Folder, Star, Trash2 } from 'lucide-react';
import type { TFunction } from 'i18next';
import { cn } from '../../../../lib/utils';
import type { Project, ProjectSession, LLMProvider } from '../../../../types/app';
import type { MCPServerStatus, SessionWithProvider } from '../../types/types';
import { getRepoSessions, getRepoSessionTotal } from '../../utils/repoAggregates';
import { getTaskIndicatorStatus } from '../../utils/utils';
import BranchChip from './BranchChip';
import NewSessionRow from './NewSessionRow';
import RecentSessions from './RecentSessions';
import TaskIndicator from './TaskIndicator';
import WorktreeRow from './WorktreeRow';

type RepoCardProps = {
  /** All projects belonging to this repo. For standalones it's a 1-element array. */
  projects: Project[];
  /** The "main" project — the repo's primary checkout. */
  mainProject: Project;
  /** Linked worktrees only (excludes main). Empty for standalones. */
  linkedWorktrees: Project[];
  isExpanded: boolean;
  isStarred: boolean;
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  currentTime: Date;
  /** Session rename state (lifted to controller). */
  editingSessionId: string | null;
  editingSessionName: string;
  /** TaskMaster integration status. */
  tasksEnabled: boolean;
  mcpServerStatus: MCPServerStatus;
  onToggle: () => void;
  onNewSession: (project: Project) => void;
  onSessionSelect: (session: SessionWithProvider, projectId: string) => void;
  onDeleteProject: (project: Project) => void;
  onDeleteSession: (
    projectId: string,
    sessionId: string,
    sessionTitle: string,
    provider: LLMProvider,
  ) => void;
  onToggleStar: (projectId: string) => void;
  onEditingSessionNameChange: (value: string) => void;
  onStartEditingSession: (sessionId: string, initialName: string) => void;
  onCancelEditingSession: () => void;
  onSaveEditingSession: (
    projectId: string,
    sessionId: string,
    summary: string,
    provider: LLMProvider,
  ) => void;
  /** Loads the next page of sessions for the main project (other worktrees paginate separately). */
  onLoadMoreSessions?: (projectId: string) => void;
  t: TFunction;
};

export default function RepoCard({
  projects,
  mainProject,
  linkedWorktrees,
  isExpanded,
  isStarred,
  selectedProject,
  selectedSession,
  currentTime,
  editingSessionId,
  editingSessionName,
  tasksEnabled,
  mcpServerStatus,
  onToggle,
  onNewSession,
  onSessionSelect,
  onDeleteProject,
  onDeleteSession,
  onToggleStar,
  onEditingSessionNameChange,
  onStartEditingSession,
  onCancelEditingSession,
  onSaveEditingSession,
  onLoadMoreSessions,
  t,
}: RepoCardProps) {
  const [worktreesExpanded, setWorktreesExpanded] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const repoSessions = useMemo(() => getRepoSessions(projects), [projects]);
  const sessionTotal = useMemo(() => getRepoSessionTotal(projects), [projects]);
  const projectsById = useMemo(
    () => Object.fromEntries(projects.map((p) => [p.projectId, p])),
    [projects],
  );

  // Split into active and archived (stale) worktrees so the latter can sit
  // behind a sub-toggle and not overwhelm the WORKTREES section.
  const { activeWorktrees, archivedWorktrees } = useMemo(() => {
    const active: Project[] = [];
    const archived: Project[] = [];
    for (const p of linkedWorktrees) {
      if (p.isStale) archived.push(p);
      else active.push(p);
    }
    return { activeWorktrees: active, archivedWorktrees: archived };
  }, [linkedWorktrees]);

  const isMainSelected = selectedProject?.projectId === mainProject.projectId;
  const branchName = mainProject.worktreeInfo?.branchName ?? null;

  // Header click only toggles expansion. Selecting a project happens implicitly
  // when the user clicks a session in RECENT or a worktree row — at which point
  // the chat pane switches and (on mobile) the sidebar closes.
  const handleHeaderClick = () => {
    onToggle();
  };

  return (
    <div className="md:space-y-0.5">
      {/* Repo header: chevron+title is the primary click target. Star and delete
          live as hover-revealed inline actions on the right so they don't crowd
          the header at rest. */}
      <div
        className={cn(
          'group relative flex items-stretch rounded-lg border border-border/40 bg-card/60 transition-colors',
          'hover:bg-accent/40',
          isMainSelected && 'bg-accent text-accent-foreground',
        )}
      >
        <button
          type="button"
          onClick={handleHeaderClick}
          className="flex min-w-0 flex-1 items-center gap-2 px-2.5 py-2 text-left"
          aria-expanded={isExpanded}
        >
          {isExpanded ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          )}
          <Folder className="h-4 w-4 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-sm font-semibold text-foreground">
                {mainProject.displayName}
              </span>
              <BranchChip branchName={branchName} emphasized origin="main" />
              {tasksEnabled && (
                <TaskIndicator
                  status={getTaskIndicatorStatus(mainProject, mcpServerStatus)}
                  size="xs"
                />
              )}
            </div>
            <div className="text-[10px] text-muted-foreground">
              {sessionTotal} {t('projects.sessionsShort', { defaultValue: 'sessions', count: sessionTotal })}
              {linkedWorktrees.length > 0 && (
                <>
                  {' · '}
                  {linkedWorktrees.length}{' '}
                  {t('projects.worktrees', {
                    defaultValue: linkedWorktrees.length === 1 ? 'worktree' : 'worktrees',
                    count: linkedWorktrees.length,
                  })}
                </>
              )}
            </div>
          </div>
        </button>
        <div className="flex items-center gap-0.5 pr-1.5">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleStar(mainProject.projectId);
            }}
            className={cn(
              'inline-flex h-7 w-7 items-center justify-center rounded-md transition-opacity hover:bg-accent',
              isStarred
                ? 'opacity-100 text-amber-500'
                : 'opacity-0 text-muted-foreground group-hover:opacity-100',
            )}
            title={t(isStarred ? 'tooltips.removeFromFavorites' : 'tooltips.addToFavorites', {
              defaultValue: isStarred ? 'Remove from favorites' : 'Add to favorites',
            })}
            aria-label={t(isStarred ? 'tooltips.removeFromFavorites' : 'tooltips.addToFavorites', {
              defaultValue: isStarred ? 'Remove from favorites' : 'Add to favorites',
            })}
          >
            <Star className={cn('h-3.5 w-3.5', isStarred && 'fill-current')} />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDeleteProject(mainProject);
            }}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
            title={t('tooltips.deleteProject', { defaultValue: 'Remove from sidebar' })}
            aria-label={t('tooltips.deleteProject', { defaultValue: 'Remove from sidebar' })}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {isExpanded && (
        <div className="space-y-1 pt-1">
          <NewSessionRow onClick={() => onNewSession(mainProject)} t={t} />

          <RecentSessions
            sessions={repoSessions}
            selectedSession={selectedSession}
            currentTime={currentTime}
            projectsById={projectsById}
            total={sessionTotal}
            editingSessionId={editingSessionId}
            editingSessionName={editingSessionName}
            onEditingSessionNameChange={onEditingSessionNameChange}
            onStartEditingSession={onStartEditingSession}
            onCancelEditingSession={onCancelEditingSession}
            onSaveEditingSession={onSaveEditingSession}
            onSessionClick={onSessionSelect}
            onDeleteSession={onDeleteSession}
            onLoadMore={onLoadMoreSessions ? () => onLoadMoreSessions(mainProject.projectId) : undefined}
            t={t}
          />

          {linkedWorktrees.length > 0 && (
            <div className="md:space-y-0.5">
              <button
                type="button"
                onClick={() => setWorktreesExpanded((prev) => !prev)}
                className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
              >
                {worktreesExpanded ? (
                  <ChevronDown className="h-3 w-3 shrink-0" />
                ) : (
                  <ChevronRight className="h-3 w-3 shrink-0" />
                )}
                <span>{t('projects.worktreesUpper', { defaultValue: 'Worktrees' })}</span>
                <span className="text-muted-foreground/60">· {activeWorktrees.length}</span>
              </button>

              {worktreesExpanded && (
                <>
                  {activeWorktrees.map((wt) => (
                    <WorktreeRow
                      key={wt.projectId}
                      project={wt}
                      isActive={selectedProject?.projectId === wt.projectId}
                      sessionCount={getRepoSessionTotal([wt])}
                      lastActivityLabel={lastActivityLabelFor(wt, currentTime, t)}
                      onOpen={(project) => {
                        const sessions = getRepoSessions([project]);
                        if (sessions.length > 0) {
                          onSessionSelect(sessions[0], project.projectId);
                        } else {
                          onNewSession(project);
                        }
                      }}
                      onNewSessionInWorktree={onNewSession}
                      onDelete={onDeleteProject}
                      t={t}
                    />
                  ))}

                  {archivedWorktrees.length > 0 && (
                    <>
                      <button
                        type="button"
                        onClick={() => setShowArchived((prev) => !prev)}
                        className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 transition-colors hover:text-foreground"
                      >
                        {showArchived ? (
                          <ChevronDown className="h-3 w-3 shrink-0" />
                        ) : (
                          <ChevronRight className="h-3 w-3 shrink-0" />
                        )}
                        <Archive className="h-3 w-3 shrink-0 opacity-70" />
                        <span>{t('projects.archived', { defaultValue: 'Archived' })}</span>
                        <span className="text-muted-foreground/60">· {archivedWorktrees.length}</span>
                      </button>
                      {showArchived &&
                        archivedWorktrees.map((wt) => (
                          <WorktreeRow
                            key={wt.projectId}
                            project={wt}
                            isActive={selectedProject?.projectId === wt.projectId}
                            sessionCount={getRepoSessionTotal([wt])}
                            lastActivityLabel={null}
                            onOpen={(project) => {
                              const sessions = getRepoSessions([project]);
                              if (sessions.length > 0) {
                                onSessionSelect(sessions[0], project.projectId);
                              } else {
                                onNewSession(project);
                              }
                            }}
                            onNewSessionInWorktree={onNewSession}
                            onDelete={onDeleteProject}
                            t={t}
                          />
                        ))}
                    </>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function lastActivityLabelFor(
  project: Project,
  now: Date,
  t: TFunction,
): string | null {
  const sessions = getRepoSessions([project]);
  if (sessions.length === 0) return null;
  const latest = sessions[0];
  const date = new Date(latest.lastActivity || latest.createdAt || 0);
  const diffMs = now.getTime() - date.getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return t('time.minutesAgo', { defaultValue: '{{count}}m ago', count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('time.hoursAgo', { defaultValue: '{{count}}h ago', count: hours });
  const days = Math.floor(hours / 24);
  return t('time.daysAgo', { defaultValue: '{{count}}d ago', count: days });
}
