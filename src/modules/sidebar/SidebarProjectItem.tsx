import { memo, useEffect, useRef, useState } from 'react';
import { Check, CheckSquare, ChevronRight, Edit3, MoreHorizontal, Plus, Star, Trash2, X } from 'lucide-react';
import type { TFunction } from 'i18next';

import { ActionMenu, Button } from '@/shared/ui';
import { cn } from '@/shared/utils';
import type { LLMProvider, Project, ProjectSession, SessionWithProvider, SidebarSessionSelection } from '@/shared/types';
import SidebarProjectSessions from '@/modules/sidebar/SidebarProjectSessions';
import SessionStatusIcon from '@/modules/sidebar/SessionStatusIcon';

type SidebarProjectItemProps = {
  project: Project;
  selectedSession: ProjectSession | null;
  isExpanded: boolean;
  isDeleting: boolean;
  isStarred: boolean;
  /** Resolved for this row: only the project being renamed re-renders on a keystroke. */
  isEditing: boolean;
  renameDraft: string;
  includeOffPagePins?: boolean;
  sessions: SessionWithProvider[];
  initialSessionsLoaded: boolean;
  isLoadingMoreSessions: boolean;
  currentTime: Date;
  /** The session being renamed, when it belongs to this project. */
  sessionRenameId: string | null;
  sessionRenameDraft: string;
  onRenameDraftChange: (name: string) => void;
  onToggleProject: (projectId: string) => void;
  onToggleStarProject: (projectId: string) => void;
  onStartEditingProject: (project: Project) => void;
  onCancelEditingProject: () => void;
  onSaveProjectName: (projectId: string, nextName: string) => void;
  onDeleteProject: (project: Project) => void;
  onSessionSelect: (session: SessionWithProvider, projectName: string) => void;
  onArchiveSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string, sessionTitle: string) => void;
  onForkSession?: (session: SessionWithProvider) => void;
  onLoadMoreSessions: (projectId: string) => void;
  activeSessions: ReadonlySet<string>;
  backgroundSessionIds: ReadonlySet<string>;
  attentionSessionIds: ReadonlySet<string>;
  onNewSession: (project: Project) => void;
  onStartEditingSession: (projectId: string, sessionId: string, initialName: string) => void;
  onCancelEditingSession: () => void;
  onSaveEditingSession: (projectName: string, sessionId: string, summary: string, provider: LLMProvider) => void;
  /** The sessions ticked in this project's list, or null when it is not the one selecting. */
  selectedSessionIds: ReadonlySet<string> | null;
  onSetSessionSelection: (selection: SidebarSessionSelection) => void;
  onToggleSessionSelected: (projectId: string, sessionId: string) => void;
  onCancelSessionSelection: () => void;
  onDeleteSelectedSessions: (sessionIds: string[]) => void;
  t: TFunction;
};

const getSessionCountDisplay = (project: Project, sessions: SessionWithProvider[]): string => {
  const total = Number(project.sessionMeta?.total ?? sessions.length);
  return String(total);
};

/** Rendered by SidebarProjectList for one project row, including its expand, rename, star and delete controls. */
function SidebarProjectItem({
  project,
  selectedSession,
  isExpanded,
  isDeleting,
  isStarred,
  isEditing,
  renameDraft,
  includeOffPagePins = true,
  sessions,
  initialSessionsLoaded,
  isLoadingMoreSessions,
  currentTime,
  sessionRenameId,
  sessionRenameDraft,
  onRenameDraftChange,
  onToggleProject,
  onToggleStarProject,
  onStartEditingProject,
  onCancelEditingProject,
  onSaveProjectName,
  onDeleteProject,
  onSessionSelect,
  onArchiveSession,
  onDeleteSession,
  onForkSession,
  onLoadMoreSessions,
  activeSessions,
  backgroundSessionIds,
  attentionSessionIds,
  onNewSession,
  onStartEditingSession,
  onCancelEditingSession,
  onSaveEditingSession,
  selectedSessionIds,
  onSetSessionSelection,
  onToggleSessionSelected,
  onCancelSessionSelection,
  onDeleteSelectedSessions,
  t,
}: SidebarProjectItemProps) {
  // Project identity is tracked by the DB-assigned `projectId` everywhere
  // after the projectName → projectId migration.
  const sessionCountDisplay = getSessionCountDisplay(project, sessions);
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Keeps the rename field in view above an on-screen keyboard.
  useEffect(() => {
    if (!isEditing || !renameInputRef.current) {
      return;
    }

    let animationFrame = 0;
    const revealInput = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(() => {
        renameInputRef.current?.scrollIntoView({ block: 'center', inline: 'nearest' });
      });
    };

    revealInput();
    window.visualViewport?.addEventListener('resize', revealInput);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.visualViewport?.removeEventListener('resize', revealInput);
    };
  }, [isEditing]);

  const toggleProject = () => onToggleProject(project.projectId);
  const toggleStarProject = () => onToggleStarProject(project.projectId);

  const saveProjectName = () => {
    onSaveProjectName(project.projectId, renameDraft);
  };

  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const newSessionLabel = `${t('sessions.newSession')}: ${project.displayName}`;
  // A collapsed project still shows the most pressing status of its sessions, drawn like their rows.
  const needsAttention = sessions.some((session) => attentionSessionIds.has(session.id));
  const hasBackgroundWork = sessions.some((session) => backgroundSessionIds.has(session.id));
  const isProcessing = sessions.some((session) => activeSessions.has(session.id) && !backgroundSessionIds.has(session.id));
  const showStatus = !isExpanded && (needsAttention || isProcessing || hasBackgroundWork);
  const startSelectingSessions = () => {
    if (!isExpanded) {
      toggleProject();
    }
    onSetSessionSelection({ projectId: project.projectId, sessionIds: new Set() });
  };


  return (
    <div className={cn('md:space-y-1', isDeleting && 'opacity-50 pointer-events-none')}>
      <div className="group sticky top-0 z-10">
        {isEditing ? (
          <div className="flex h-[34px] items-center gap-1 bg-background px-2.5 max-md:h-11">
            <input
              ref={renameInputRef}
              type="text"
              value={renameDraft}
              onChange={(event) => onRenameDraftChange(event.target.value)}
              // 16px on touch screens stops iOS zooming into the field.
              className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-sm text-foreground focus:ring-2 focus:ring-primary/20 max-md:text-base"
              placeholder={t('projects.projectNamePlaceholder')}
              autoFocus
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  saveProjectName();
                }
                if (event.key === 'Escape') {
                  // Cancelling the rename must not also close the code editor.
                  event.stopPropagation();
                  onCancelEditingProject();
                }
              }}
            />
            <Button variant="ghost" size="icon" className="h-6 w-6 text-green-600" onClick={saveProjectName} title={t('tooltips.save')}>
              <Check className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground" onClick={onCancelEditingProject} title={t('tooltips.cancel')}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        ) : (
          <div className="relative bg-background">
            <button
              type="button"
              className="flex h-[34px] w-full items-center gap-2.5 rounded-lg px-2.5 text-left transition-colors hover:bg-accent/50 max-md:h-11 [@media(hover:none)]:pr-[4.25rem]"
              onClick={toggleProject}
              aria-expanded={isExpanded}
              title={project.fullPath}
            >
              <ChevronRight className={cn('h-3.5 w-3.5 flex-shrink-0 text-muted-foreground transition-transform', isExpanded && 'rotate-90')} />
              <span className="min-w-0 flex-1 truncate text-row font-medium text-foreground">{project.displayName}</span>
              {/* Gives way to the row actions on hover; touch screens keep both. */}
              <span className="flex flex-shrink-0 items-center gap-2 [@media(hover:hover)]:group-hover:invisible">
                {showStatus && (
                  <SessionStatusIcon
                    provider={sessions[0].__provider}
                    needsAttention={needsAttention}
                    isProcessing={isProcessing}
                    hasBackgroundWork={hasBackgroundWork}
                    t={t}
                  />
                )}
                {isStarred && <Star className="h-3.5 w-3.5 fill-amber-500 text-amber-500" aria-label={t('projects.starred')} />}
                <span className="text-xs tabular-nums text-muted-foreground/70">{sessionCountDisplay}</span>
              </span>
            </button>
            <div
              className={cn(
                'absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center',
                // Revealed on hover; kept while the menu is open.
                !isMenuOpen && 'opacity-0 focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100',
              )}
            >
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                onClick={() => onNewSession(project)}
                title={newSessionLabel}
                aria-label={newSessionLabel}
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
              <ActionMenu
                label={t('tooltips.projectOptions', 'Project options')}
                ariaLabel={`${t('tooltips.projectOptions', 'Project options')}: ${project.displayName}`}
                icon={MoreHorizontal}
                iconOnly
                portal
                variant="ghost"
                size="icon"
                triggerClassName="h-7 w-7 text-muted-foreground hover:text-foreground"
                onOpenChange={setIsMenuOpen}
                items={[
                  {
                    key: 'star',
                    label: isStarred ? t('tooltips.removeFromFavorites') : t('tooltips.addToFavorites'),
                    icon: Star,
                    onSelect: toggleStarProject,
                  },
                  { key: 'rename', label: t('actions.rename'), icon: Edit3, onSelect: () => onStartEditingProject(project) },
                  { key: 'select', label: t('sessions.select'), icon: CheckSquare, onSelect: startSelectingSessions },
                  {
                    key: 'delete',
                    label: t('projects.deleteProject'),
                    icon: Trash2,
                    isDanger: true,
                    showDividerBefore: true,
                    onSelect: () => onDeleteProject(project),
                  },
                ]}
              />
            </div>
          </div>
        )}
      </div>

      <SidebarProjectSessions
        project={project}
        isExpanded={isExpanded}
        includeOffPagePins={includeOffPagePins}
        sessions={sessions}
        selectedSession={selectedSession}
        initialSessionsLoaded={initialSessionsLoaded}
        hasMoreSessions={Boolean(project.sessionMeta?.hasMore)}
        isLoadingMoreSessions={isLoadingMoreSessions}
        activeSessions={activeSessions}
        backgroundSessionIds={backgroundSessionIds}
        attentionSessionIds={attentionSessionIds}
        currentTime={currentTime}
        sessionRenameId={sessionRenameId}
        sessionRenameDraft={sessionRenameDraft}
        onRenameDraftChange={onRenameDraftChange}
        onStartEditingSession={onStartEditingSession}
        onCancelEditingSession={onCancelEditingSession}
        onSaveEditingSession={onSaveEditingSession}
        onSessionSelect={onSessionSelect}
        onArchiveSession={onArchiveSession}
        onDeleteSession={onDeleteSession}
        onForkSession={onForkSession}
        onLoadMoreSessions={onLoadMoreSessions}
        selectedSessionIds={selectedSessionIds}
        onSetSessionSelection={onSetSessionSelection}
        onToggleSessionSelected={onToggleSessionSelected}
        onCancelSessionSelection={onCancelSessionSelection}
        onDeleteSelectedSessions={onDeleteSelectedSessions}
        t={t}
      />
    </div>
  );
}

/**
 * Memoized: a websocket session delta re-renders the sidebar roughly every
 * 0.5-2s during a run, and a rename keystroke re-renders it per character.
 *
 * Both renames are resolved to scalars by SidebarProjectList and the sorted
 * session array is cached per project, so a keystroke changes props on exactly
 * one row and every other row's compare succeeds. See sidebarRowProps.test.tsx.
 */
export default memo(SidebarProjectItem);
