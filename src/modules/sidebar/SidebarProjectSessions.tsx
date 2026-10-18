import { useMemo, useState } from 'react';
import { CheckSquare, ChevronRight, GitBranch, Plus, Trash2 } from 'lucide-react';
import type { TFunction } from 'i18next';

import { Button } from '@/shared/ui';
import { cn } from '@/shared/utils';
import type { LLMProvider, Project, ProjectSession, SessionWithProvider, SidebarSessionSelection } from '@/shared/types';
import SidebarSessionItem from '@/modules/sidebar/SidebarSessionItem';
import { useCompactSidebar } from '@/modules/sidebar/hooks/useCompactSidebar';
import { buildProjectSessionTree } from '@/modules/sidebar/utils/projectSessionTree';

type SidebarProjectSessionsProps = {
  project: Project;
  isExpanded: boolean;
  sessions: SessionWithProvider[];
  selectedSession: ProjectSession | null;
  initialSessionsLoaded: boolean;
  hasMoreSessions: boolean;
  isLoadingMoreSessions: boolean;
  activeSessions: ReadonlySet<string>;
  backgroundSessionIds: ReadonlySet<string>;
  attentionSessionIds: ReadonlySet<string>;
  currentTime: Date;
  /** The session being renamed, when it belongs to this project. */
  sessionRenameId: string | null;
  sessionRenameDraft: string;
  onRenameDraftChange: (draft: string) => void;
  onStartEditingSession: (projectId: string, sessionId: string, initialName: string) => void;
  onCancelEditingSession: () => void;
  onSaveEditingSession: (projectName: string, sessionId: string, summary: string, provider: LLMProvider) => void;
  onProjectSelect: (project: Project) => void;
  onSessionSelect: (session: SessionWithProvider, projectName: string) => void;
  onDeleteSession: (sessionId: string, sessionTitle: string) => void;
  onForkSession?: (session: SessionWithProvider) => void;
  onLoadMoreSessions: (projectId: string) => void;
  onNewSession: (project: Project) => void;
  /** The sessions ticked here, or null when this project's list is not in selection mode. */
  selectedSessionIds: ReadonlySet<string> | null;
  onSetSessionSelection: (selection: SidebarSessionSelection) => void;
  onToggleSessionSelected: (projectId: string, sessionId: string) => void;
  onCancelSessionSelection: () => void;
  onDeleteSelectedSessions: (sessionIds: string[]) => void;
  t: TFunction;
};

function SessionListSkeleton() {
  return (
    <>
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className="rounded-md p-2">
          <div className="flex items-start gap-2">
            <div className="mt-0.5 h-3 w-3 animate-pulse rounded-full bg-muted" />
            <div className="flex-1 space-y-1">
              <div className="h-3 animate-pulse rounded bg-muted" style={{ width: `${60 + index * 15}%` }} />
              <div className="h-2 w-1/2 animate-pulse rounded bg-muted" />
            </div>
          </div>
        </div>
      ))}
    </>
  );
}

/** Rendered by SidebarProjectItem to show an expanded project's sessions, delegating each row to SidebarSessionItem. */
export default function SidebarProjectSessions({
  project,
  isExpanded,
  sessions,
  selectedSession,
  initialSessionsLoaded,
  hasMoreSessions,
  isLoadingMoreSessions,
  activeSessions,
  backgroundSessionIds,
  attentionSessionIds,
  currentTime,
  sessionRenameId,
  sessionRenameDraft,
  onRenameDraftChange,
  onStartEditingSession,
  onCancelEditingSession,
  onSaveEditingSession,
  onProjectSelect,
  onSessionSelect,
  onDeleteSession,
  onForkSession,
  onLoadMoreSessions,
  onNewSession,
  selectedSessionIds,
  onSetSessionSelection,
  onToggleSessionSelected,
  onCancelSessionSelection,
  onDeleteSelectedSessions,
  t,
}: SidebarProjectSessionsProps) {
  const isCompact = useCompactSidebar();
  const treeRows = useMemo(() => buildProjectSessionTree(sessions, project.projectId), [sessions, project.projectId]);
  const selectedSessionId = selectedSession?.id ?? null;
  const targetAncestors = useMemo(() => {
    const parents = new Map(treeRows.map((row) => [row.session.id, row.parentId]));
    const reveal = new Set<string>();
    for (const target of [selectedSessionId, sessionRenameId]) {
      let parentId = target ? parents.get(target) : null;
      while (parentId && !reveal.has(parentId)) {
        reveal.add(parentId);
        parentId = parents.get(parentId);
      }
    }
    return reveal;
  }, [treeRows, selectedSessionId, sessionRenameId]);
  const [forkTreeState, setForkTreeState] = useState(() => ({
    targetAncestors, selectedSessionId, sessionRenameId, collapsedForks: new Set<string>(),
  }));
  const { collapsedForks } = forkTreeState;

  // Reveal a newly selected/renamed fork before committing a hidden row. Later
  // title/activity updates must not undo an explicit collapse by the user.
  if (forkTreeState.selectedSessionId !== selectedSessionId
    || forkTreeState.sessionRenameId !== sessionRenameId
    || forkTreeState.targetAncestors.size !== targetAncestors.size
    || [...targetAncestors].some((id) => !forkTreeState.targetAncestors.has(id))) {
    setForkTreeState({
      targetAncestors, selectedSessionId, sessionRenameId,
      collapsedForks: new Set([...collapsedForks].filter((id) => !targetAncestors.has(id))),
    });
  }

  const visibleRows = useMemo(() => {
    let hiddenBelowDepth = Infinity;
    const visible: typeof treeRows = [];
    for (const row of treeRows) {
      if (row.depth > hiddenBelowDepth) continue;
      hiddenBelowDepth = row.hasChildren && collapsedForks.has(row.session.id) ? row.depth : Infinity;
      visible.push(row);
    }
    return visible;
  }, [treeRows, collapsedForks]);
  const hasForks = treeRows.some((row) => row.hasChildren);

  if (!isExpanded) {
    return null;
  }

  const hasSessions = treeRows.length > 0;
  const isSelecting = selectedSessionIds !== null;
  // A session with a response in flight cannot be deleted — the same rule the
  // row's options menu applies — so it is not selectable either.
  const isSessionRunning = (session: SessionWithProvider) =>
    activeSessions.has(session.id) && !backgroundSessionIds.has(session.id);
  const selectableSessionIds = treeRows.filter(({ session }) => !isSessionRunning(session)).map(({ session }) => session.id);
  // Re-derived from the selectable rows rather than read straight off the
  // selection, so a row that started running after it was ticked drops out of
  // the count, the button and the ids the confirmation is opened with.
  const effectiveSelectedIds = selectedSessionIds
    ? selectableSessionIds.filter((sessionId) => selectedSessionIds.has(sessionId))
    : [];
  const checkedSessionIds = new Set(effectiveSelectedIds);
  const allLoadedSelected =
    selectableSessionIds.length > 0 && effectiveSelectedIds.length === selectableSessionIds.length;
  // With more sessions on the server than on screen, the button only reaches the
  // loaded rows, so it offers "Select all loaded" rather than a "Select all" it
  // could not honour. Once those rows are ticked it flips to "Clear" either way.
  const selectAllLabel = allLoadedSelected
    ? t('sessions.clearSelection')
    : hasMoreSessions
      ? t('sessions.selectAllLoaded')
      : t('sessions.selectAll');

  return (
    <div className="ml-3 space-y-1 border-l border-border pl-3">
      {isCompact ? (
        <div className="px-3 pb-1 pt-1">
          <button
            className="flex h-8 w-full items-center justify-center gap-2 rounded-md bg-primary text-xs font-medium text-primary-foreground transition-all duration-150 hover:bg-primary/90 active:scale-[0.98]"
            onClick={() => {
              onProjectSelect(project);
              onNewSession(project);
            }}
          >
            <Plus className="h-3 w-3" />
            {t('sessions.newSession')}
          </button>
        </div>
      ) : (
        <Button
          variant="default"
          size="sm"
          className="flex h-8 w-full justify-start gap-2 bg-primary text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          onClick={() => onNewSession(project)}
        >
          <Plus className="h-3 w-3" />
          {t('sessions.newSession')}
        </Button>
      )}

      {(isSelecting || (initialSessionsLoaded && selectableSessionIds.length > 0)) && (
        <div className={cn('space-y-1', isCompact && 'px-3')}>
          {isSelecting ? (
            <>
              {/* Wraps rather than clips: at the narrowest sidebar width a long
                  translated "Select all loaded" leaves no room for Cancel. */}
              <div className="flex flex-wrap items-center justify-between gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() =>
                    onSetSessionSelection({
                      projectId: project.projectId,
                      sessionIds: new Set(allLoadedSelected ? [] : selectableSessionIds),
                    })
                  }
                  disabled={selectableSessionIds.length === 0}
                >
                  {selectAllLabel}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                  onClick={onCancelSessionSelection}
                >
                  {t('actions.cancel')}
                </Button>
              </div>
              <Button
                variant="destructive"
                size="sm"
                className="h-8 w-full justify-center gap-2 bg-red-600 text-xs font-medium text-white hover:bg-red-700"
                onClick={() => onDeleteSelectedSessions(effectiveSelectedIds)}
                disabled={effectiveSelectedIds.length === 0}
              >
                <Trash2 className="h-3 w-3" />
                {t('sessions.deleteSelected', { count: effectiveSelectedIds.length })}
              </Button>
            </>
          ) : (
            <div className="flex justify-end">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
                onClick={() =>
                  onSetSessionSelection({ projectId: project.projectId, sessionIds: new Set() })
                }
              >
                <CheckSquare className="h-3 w-3" />
                {t('sessions.select')}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* A page emptied by deleting every loaded row still has sessions behind
          it on the server, so it keeps its "Load more" instead of "No sessions". */}
      {!initialSessionsLoaded ? (
        <SessionListSkeleton />
      ) : !hasSessions && !hasMoreSessions ? (
        <div className="px-3 py-2 text-left">
          <p className="text-xs text-muted-foreground">{t('sessions.noSessions')}</p>
        </div>
      ) : (
        <>
          <div className="space-y-1" data-testid="project-session-tree">
            {visibleRows.map(({ session, parentId, depth, hasChildren }) => (
              <div
                key={session.id}
                data-session-id={session.id}
                data-parent-session-id={parentId ?? undefined}
                data-fork-depth={depth}
                className={cn('flex min-w-0 items-start', depth > 0 && 'border-l border-border/60')}
                style={depth > 0 ? { marginLeft: `${Math.min(depth, 4) * 12}px` } : undefined}
              >
                {hasForks && (
                  hasChildren ? (
                    <button
                      type="button"
                      className="mt-1 flex h-8 w-6 flex-shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      aria-expanded={!collapsedForks.has(session.id)}
                      aria-label={collapsedForks.has(session.id)
                        ? t('sessions.expandForks', { session: session.summary || session.name || t('projects.newSession') })
                        : t('sessions.collapseForks', { session: session.summary || session.name || t('projects.newSession') })}
                      onClick={() => setForkTreeState((previous) => {
                        const next = new Set(previous.collapsedForks);
                        if (next.has(session.id)) next.delete(session.id);
                        else next.add(session.id);
                        return { ...previous, collapsedForks: next };
                      })}
                    >
                      <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', !collapsedForks.has(session.id) && 'rotate-90')} aria-hidden="true" />
                    </button>
                  ) : (
                    <span className="mt-1 flex h-8 w-6 flex-shrink-0 items-center justify-center text-muted-foreground/60" aria-hidden="true">
                      {parentId && <GitBranch className="h-3 w-3" />}
                    </span>
                  )
                )}
                <div className="min-w-0 flex-1">
                  <SidebarSessionItem
                    project={project}
                    session={session}
                    selectedSession={selectedSession}
                    isProcessing={isSessionRunning(session)}
                    hasBackgroundWork={backgroundSessionIds.has(session.id)}
                    needsAttention={attentionSessionIds.has(session.id)}
                    currentTime={currentTime}
                    onRenameDraftChange={onRenameDraftChange}
                    isEditing={session.id === sessionRenameId}
                    renameDraft={session.id === sessionRenameId ? sessionRenameDraft : ''}
                    onStartEditingSession={onStartEditingSession}
                    onCancelEditingSession={onCancelEditingSession}
                    onSaveEditingSession={onSaveEditingSession}
                    onProjectSelect={onProjectSelect}
                    onSessionSelect={onSessionSelect}
                    onDeleteSession={onDeleteSession}
                    onForkSession={onForkSession}
                    isSelecting={isSelecting}
                    isChecked={checkedSessionIds.has(session.id)}
                    onToggleSessionSelected={onToggleSessionSelected}
                    t={t}
                  />
                </div>
              </div>
            ))}
          </div>

          {hasMoreSessions && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-full justify-center text-xs text-muted-foreground hover:text-foreground"
              onClick={() => onLoadMoreSessions(project.projectId)}
              disabled={isLoadingMoreSessions}
            >
              {isLoadingMoreSessions ? t('sessions.loadingSessions') : 'Load more sessions'}
            </Button>
          )}
        </>
      )}
    </div>
  );
}
