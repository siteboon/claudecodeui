import { useMemo, useState } from 'react';
import { Archive, ChevronDown, ChevronRight, Folder } from 'lucide-react';
import type { TFunction } from 'i18next';
import { cn } from '../../../../lib/utils';
import type { Project, ProjectSession } from '../../../../types/app';
import type {
  AdditionalSessionsByProject,
  SessionWithProvider,
} from '../../types/types';
import { getRepoSessions, getRepoSessionTotal } from '../../utils/repoAggregates';
import BranchChip from './BranchChip';
import NewSessionRow from './NewSessionRow';
import RecentSessions from './RecentSessions';
import WorktreeRow from './WorktreeRow';

type RepoCardProps = {
  /** All projects belonging to this repo. For standalones it's a 1-element array. */
  projects: Project[];
  /** The "main" project — the repo's primary checkout. */
  mainProject: Project;
  /** Linked worktrees only (excludes main). Empty for standalones. */
  linkedWorktrees: Project[];
  isExpanded: boolean;
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  additionalSessions: AdditionalSessionsByProject;
  currentTime: Date;
  onToggle: () => void;
  onNewSession: (project: Project) => void;
  onSessionSelect: (session: SessionWithProvider, projectName: string) => void;
  onDeleteProject: (project: Project) => void;
  t: TFunction;
};

export default function RepoCard({
  projects,
  mainProject,
  linkedWorktrees,
  isExpanded,
  selectedProject,
  selectedSession,
  additionalSessions,
  currentTime,
  onToggle,
  onNewSession,
  onSessionSelect,
  onDeleteProject,
  t,
}: RepoCardProps) {
  const [worktreesExpanded, setWorktreesExpanded] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const repoSessions = useMemo(
    () => getRepoSessions(projects, additionalSessions),
    [projects, additionalSessions],
  );
  const sessionTotal = useMemo(() => getRepoSessionTotal(projects), [projects]);
  const projectsByName = useMemo(
    () => Object.fromEntries(projects.map((p) => [p.name, p])),
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

  const isMainSelected = selectedProject?.name === mainProject.name;
  const branchName = mainProject.worktreeInfo?.branchName ?? null;

  // Header click only toggles expansion. Selecting a project happens implicitly
  // when the user clicks a session in RECENT or a worktree row — at which point
  // the chat pane switches and (on mobile) the sidebar closes. This keeps the
  // header tap a pure browse action so users can explore without losing the menu.
  const handleHeaderClick = () => {
    onToggle();
  };

  return (
    <div className="md:space-y-0.5">
      {/* Repo header */}
      <button
        type="button"
        onClick={handleHeaderClick}
        className={cn(
          'group flex w-full items-center gap-2 rounded-lg border border-border/40 bg-card/60 px-2.5 py-2 text-left transition-colors',
          'hover:bg-accent/40',
          isMainSelected && 'bg-accent text-accent-foreground',
        )}
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

      {isExpanded && (
        <div className="space-y-1 pt-1">
          <NewSessionRow onClick={() => onNewSession(mainProject)} t={t} />

          <RecentSessions
            sessions={repoSessions}
            selectedSession={selectedSession}
            currentTime={currentTime}
            projectsByName={projectsByName}
            onSessionClick={onSessionSelect}
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
                      key={wt.name}
                      project={wt}
                      isActive={selectedProject?.name === wt.name}
                      sessionCount={getRepoSessionTotal([wt])}
                      lastActivityLabel={lastActivityLabelFor(wt, additionalSessions, currentTime, t)}
                      onOpen={(project) => {
                        const sessions = getRepoSessions([project], additionalSessions);
                        if (sessions.length > 0) {
                          onSessionSelect(sessions[0], project.name);
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
                            key={wt.name}
                            project={wt}
                            isActive={selectedProject?.name === wt.name}
                            sessionCount={getRepoSessionTotal([wt])}
                            lastActivityLabel={null}
                            onOpen={(project) => {
                              const sessions = getRepoSessions([project], additionalSessions);
                              if (sessions.length > 0) {
                                onSessionSelect(sessions[0], project.name);
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
  additionalSessions: AdditionalSessionsByProject,
  now: Date,
  t: TFunction,
): string | null {
  const sessions = getRepoSessions([project], additionalSessions);
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
