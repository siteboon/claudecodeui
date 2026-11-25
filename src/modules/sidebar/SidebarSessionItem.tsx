import { memo } from 'react';
import type { KeyboardEvent } from 'react';
import { CheckSquare, Pin, Square } from 'lucide-react';
import type { TFunction } from 'i18next';

import { buttonVariants } from '@/shared/ui';
import { cn } from '@/shared/utils';
import type { LLMProvider, Project, ProjectSession, SessionWithProvider } from '@/shared/types';
import { createSessionViewModel, formatCompactAge } from '@/modules/sidebar/utils/sidebarProjectFormatting';
import SessionOptions from '@/modules/sidebar/SessionOptions';
import SessionStatusIcon from '@/modules/sidebar/SessionStatusIcon';
import { useSessionPins } from '@/modules/sidebar/hooks/useSessionPins';

type SidebarSessionItemProps = {
  project: Project;
  session: SessionWithProvider;
  selectedSession: ProjectSession | null;
  isProcessing: boolean;
  /** The session's turn has ended but the agents, workflows or commands it launched still run. */
  hasBackgroundWork: boolean;
  needsAttention: boolean;
  currentTime: Date;
  /** Resolved for this row, so a keystroke elsewhere does not invalidate it. */
  isEditing: boolean;
  renameDraft: string;
  onRenameDraftChange: (draft: string) => void;
  onStartEditingSession: (projectId: string, sessionId: string, initialName: string) => void;
  onCancelEditingSession: () => void;
  onSaveEditingSession: (projectName: string, sessionId: string, summary: string, provider: LLMProvider) => void;
  onSessionSelect: (session: SessionWithProvider, projectName: string) => void;
  onArchiveSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string, sessionTitle: string) => void;
  /** Branches this session into an independent one; absent when its provider cannot. */
  onForkSession?: (session: SessionWithProvider) => void;
  /** This project's list is in bulk-selection mode: the row acts as a checkbox and hides its options. */
  isSelecting: boolean;
  /** Ticked for the pending bulk delete. Resolved by the list, which never ticks a running row. */
  isChecked: boolean;
  /** Project fork trees use denser rows so indentation does not consume the title's space. */
  treeRow?: boolean;
  /** Takes the owning projectId so this memoized row binds itself without the list making a closure per row. */
  onToggleSessionSelected: (projectId: string, sessionId: string) => void;
  t: TFunction;
};

/** Rendered by SidebarProjectSessions for one session row, on desktop and touch alike, with its options menu and inline rename. */
function SidebarSessionItem({
  project,
  session,
  selectedSession,
  isProcessing,
  hasBackgroundWork,
  needsAttention,
  currentTime,
  isEditing,
  renameDraft,
  onRenameDraftChange,
  onStartEditingSession,
  onCancelEditingSession,
  onSaveEditingSession,
  onSessionSelect,
  onArchiveSession,
  onDeleteSession,
  onForkSession,
  isSelecting,
  isChecked,
  treeRow = false,
  onToggleSessionSelected,
  t,
}: SidebarSessionItemProps) {
  const sessionView = createSessionViewModel(session, currentTime, t);
  const isSelected = selectedSession?.id === session.id;
  // Pinning lives in the options menu, so the row itself marks a pinned session.
  const isPinned = useSessionPins()?.pinnedIds.has(session.id) ?? false;
  const compactSessionAge = formatCompactAge(sessionView.sessionTime, currentTime);
  const statusIcon = (
    <SessionStatusIcon
      provider={session.__provider}
      needsAttention={needsAttention && !isSelected}
      isProcessing={isProcessing}
      hasBackgroundWork={hasBackgroundWork}
      t={t}
    />
  );
  // While busy the status icon speaks for the row, so the age gives way to it.
  const showAge = Boolean(compactSessionAge) && !isProcessing && !hasBackgroundWork;
  // A running session cannot be deleted, so it cannot be ticked either; the row
  // still renders, locked, instead of disappearing from the list mid-selection.
  const isSelectable = isSelecting && !isProcessing;
  const toggleSelected = () => {
    onToggleSessionSelected(project.projectId, session.id);
  };
  // The anchor activates on Enter but not Space; both tick the row while selecting.
  const handleSelectionKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!isSelectable || (event.key !== ' ' && event.key !== 'Enter')) {
      return;
    }
    event.preventDefault();
    toggleSelected();
  };
  const SelectionIcon = isChecked ? CheckSquare : Square;
  const selectionIcon = isSelecting ? (
    <SelectionIcon
      className={cn(
        'h-4 w-4 flex-shrink-0',
        isChecked ? 'text-primary' : 'text-muted-foreground',
        !isSelectable && 'opacity-40',
      )}
      aria-hidden="true"
    />
  ) : null;

  return (
    <div className="group relative">
      <a
        href={`/session/${session.id}`}
        role={isSelecting ? 'checkbox' : undefined}
        aria-checked={isSelecting ? isChecked : undefined}
        aria-disabled={isSelecting && !isSelectable ? true : undefined}
        className={cn(
          buttonVariants({ variant: 'ghost' }),
          'h-[34px] w-full justify-start rounded-lg px-2.5 text-left font-normal max-md:h-11 [@media(hover:none)]:pr-9',
          isSelected ? 'bg-accent' : 'hover:bg-accent/50',
          isChecked && 'bg-primary/10',
        )}
        // Left-click keeps in-app navigation; Ctrl/Cmd/middle-click and the
        // native right-click menu use the href to open a new tab/window.
        // While selecting, every click ticks the row instead.
        onClick={(event) => {
          if (isSelecting) {
            event.preventDefault();
            if (isSelectable) {
              toggleSelected();
            }
            return;
          }
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          if (event.detail > 1) return;
          onSessionSelect(session, project.projectId);
        }}
        onKeyDown={isSelecting ? handleSelectionKeyDown : undefined}
      >
        <div className={cn('flex w-full min-w-0 items-center', treeRow ? 'gap-2' : 'gap-2.5')}>
          {selectionIcon}
          {statusIcon}
          <div
            className="min-w-0 flex-1 truncate text-row font-normal text-foreground"
            title={sessionView.sessionName}
            onDoubleClick={(event) => {
              if (isSelecting || isEditing || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              event.stopPropagation();
              onStartEditingSession(project.projectId, session.id, sessionView.sessionName);
            }}
          >
            {sessionView.sessionName}
          </div>
          {isPinned && <Pin className="h-3 w-3 flex-shrink-0 text-muted-foreground" aria-label={t('pinned.pinned', 'Pinned')} />}
          {showAge && (
            // Gives way to the options menu on hover; touch screens keep both.
            <span
              className={cn(
                'flex-shrink-0 text-xs tabular-nums text-muted-foreground',
                isEditing ? 'invisible' : !isSelecting && '[@media(hover:hover)]:group-hover:invisible',
              )}
            >
              {compactSessionAge}
            </span>
          )}
        </div>
      </a>

      {!isSelecting && (
        <SessionOptions
          className="absolute right-1.5 top-1/2 -translate-y-1/2"
          sessionId={session.id}
          sessionName={sessionView.sessionName}
          provider={session.__provider}
          projectId={project.projectId}
          isProcessing={isProcessing}
          isEditing={isEditing}
          renameDraft={renameDraft}
          onRenameDraftChange={onRenameDraftChange}
          onStartEditingSession={onStartEditingSession}
          onCancelEditingSession={onCancelEditingSession}
          onSaveEditingSession={onSaveEditingSession}
          onArchiveSession={onArchiveSession}
          onDeleteSession={onDeleteSession}
          onFork={onForkSession ? () => onForkSession(session) : undefined}
          t={t}
        />
      )}
    </div>
  );
}

/**
 * Memoized: a websocket session delta re-renders the sidebar roughly every
 * 0.5-2s during a run, and a rename keystroke re-renders it per character.
 *
 * SidebarProjectSessions hands every row but the one being renamed a constant
 * draft, and the session objects come from a per-project cache, so the compare
 * succeeds for the rest. See sidebarRowProps.test.tsx.
 */
export default memo(SidebarSessionItem);
