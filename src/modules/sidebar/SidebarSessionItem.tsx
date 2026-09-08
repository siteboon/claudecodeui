import { memo, useState } from 'react';
import { Check, Edit2, Loader2, MoreHorizontal, Trash2, X } from 'lucide-react';
import type { TFunction } from 'i18next';

import { Badge, Dialog, DialogContent, DialogTitle, LLMProviderLogo, Tooltip, buttonVariants } from '@/shared/ui';
import { cn } from '@/shared/utils';
import type { LLMProvider, Project, ProjectSession, SessionWithProvider } from '@/shared/types';
import { PROVIDER_LABELS, createSessionViewModel, formatCompactAge } from '@/modules/sidebar/utils/sidebarProjectFormatting';
import { useCompactSidebar } from '@/modules/sidebar/hooks/useCompactSidebar';
import { useProviderSessionIdCopy } from '@/modules/sidebar/hooks/useProviderSessionIdCopy';
import SessionOptions from '@/modules/sidebar/SessionOptions';

type SidebarSessionItemProps = {
  project: Project;
  session: SessionWithProvider;
  selectedSession: ProjectSession | null;
  isProcessing: boolean;
  needsAttention: boolean;
  currentTime: Date;
  /** Resolved for this row, so a keystroke elsewhere does not invalidate it. */
  isEditing: boolean;
  renameDraft: string;
  onRenameDraftChange: (draft: string) => void;
  onStartEditingSession: (projectId: string, sessionId: string, initialName: string) => void;
  onCancelEditingSession: () => void;
  onSaveEditingSession: (projectName: string, sessionId: string, summary: string, provider: LLMProvider) => void;
  onProjectSelect: (project: Project) => void;
  onSessionSelect: (session: SessionWithProvider, projectName: string) => void;
  onDeleteSession: (sessionId: string, sessionTitle: string) => void;
  /** Branches this session into an independent one; absent when its provider cannot. */
  onForkSession?: (session: SessionWithProvider) => void;
  t: TFunction;
};

/** Rendered by SidebarProjectSessions for one session row, including its rename, copy and delete controls. */
function SidebarSessionItem({
  project,
  session,
  selectedSession,
  isProcessing,
  needsAttention,
  currentTime,
  isEditing,
  renameDraft,
  onRenameDraftChange,
  onStartEditingSession,
  onCancelEditingSession,
  onSaveEditingSession,
  onProjectSelect,
  onSessionSelect,
  onDeleteSession,
  onForkSession,
  t,
}: SidebarSessionItemProps) {
  const isCompact = useCompactSidebar();
  const sessionView = createSessionViewModel(session, currentTime, t);
  const isSelected = selectedSession?.id === session.id;
  const compactSessionAge = formatCompactAge(sessionView.sessionTime, currentTime);
  const [isMobileOptionsOpen, setIsMobileOptionsOpen] = useState(false);
  const showAttentionIndicator = needsAttention && !isSelected;
  const showRecentIndicator = !showAttentionIndicator && !isProcessing && sessionView.isActive;
  const providerLabel = PROVIDER_LABELS[session.__provider];

  // The desktop controls live in SessionOptions, which owns the rename panel and
  // its outside-click dismissal. The mobile rename sits inside the bottom sheet,
  // which owns its own.
  const { copyState, copyLabel, setOptionsOpen, handleCopyAction, isCopyPending, CopyStateIcon } =
    useProviderSessionIdCopy(session.id, providerLabel);

  // Sessions are owned by a project identified by `projectId` (DB primary key)
  // after the projectName → projectId migration.
  const selectMobileSession = () => {
    onProjectSelect(project);
    onSessionSelect(session, project.projectId);
  };

  const saveEditedSession = () => {
    onSaveEditingSession(project.projectId, session.id, renameDraft, session.__provider);
  };

  const requestDeleteSession = () => {
    onDeleteSession(session.id, sessionView.sessionName);
  };

  const setMobileOptionsOpen = (open: boolean) => {
    setIsMobileOptionsOpen(open);
    setOptionsOpen(open);
    if (!open && isEditing) {
      onCancelEditingSession();
    }
  };

  const startMobileRename = () => {
    onStartEditingSession(project.projectId, session.id, sessionView.sessionName);
  };

  const saveMobileRename = () => {
    saveEditedSession();
    setMobileOptionsOpen(false);
  };

  return (
    <div className="group relative">
      {(showAttentionIndicator || showRecentIndicator) && (
        <div className="absolute left-0 top-1/2 -translate-x-1 -translate-y-1/2 transform">
          <Tooltip
            content={showAttentionIndicator
              ? t('tooltips.attentionRequiredIndicator', { defaultValue: 'Session needs attention' })
              : t('tooltips.activeSessionIndicator')}
            position="right"
          >
            <div
              role="status"
              aria-label={showAttentionIndicator
                ? t('tooltips.attentionRequiredIndicator', { defaultValue: 'Session needs attention' })
                : t('tooltips.activeSessionIndicator')}
              className={cn(
                'h-2 w-2 animate-pulse rounded-full',
                showAttentionIndicator ? 'bg-amber-500' : 'bg-green-500',
              )}
            />
          </Tooltip>
        </div>
      )}

      {isCompact && (
      <div>
        <div
          className={cn(
            'p-2 mx-3 my-0.5 rounded-md bg-card border active:scale-[0.98] transition-all duration-150 relative',
            isSelected ? 'bg-primary/5 border-primary/20' : '',
            !isSelected && isProcessing
              ? 'border-border/60 bg-muted/20'
              : !isSelected && sessionView.isActive
              ? 'border-green-500/30 bg-green-50/5 dark:bg-green-900/5'
              : 'border-border/30',
          )}
          onClick={selectMobileSession}
        >
          <div className="flex items-center gap-2">
            <div
              className={cn(
                'w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0',
                isSelected ? 'bg-primary/10' : 'bg-muted/50',
              )}
            >
              <LLMProviderLogo provider={session.__provider} className="h-3 w-3" />
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <div
                  className="min-w-0 flex-1 truncate text-sm font-normal text-foreground"
                  title={sessionView.sessionName}
                >
                  {sessionView.sessionName}
                </div>
                {isProcessing ? (
                  <span className="ml-auto flex-shrink-0">
                    <Tooltip content={t('tooltips.processingSessionIndicator', 'Processing session')} position="top">
                      <span className="flex h-5 w-5 items-center justify-center rounded-md text-muted-foreground">
                        <Loader2 className="h-3 w-3 animate-spin" />
                      </span>
                    </Tooltip>
                  </span>
                ) : compactSessionAge && (
                  <span className="ml-auto flex-shrink-0 text-[11px] text-muted-foreground">{compactSessionAge}</span>
                )}
              </div>
              <div className="mt-0.5 flex items-center">
                {sessionView.messageCount > 0 && (
                  <Badge variant="secondary" className="px-1 py-0 text-xs">
                    {sessionView.messageCount}
                  </Badge>
                )}
              </div>
            </div>

            <button
              type="button"
              aria-label={`Session options for ${sessionView.sessionName}`}
              aria-haspopup="dialog"
              aria-expanded={isMobileOptionsOpen}
              className="ml-1 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted active:scale-95"
              onClick={(event) => {
                event.stopPropagation();
                setMobileOptionsOpen(true);
              }}
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </div>
        </div>

        <Dialog open={isMobileOptionsOpen} onOpenChange={setMobileOptionsOpen}>
          <DialogContent
            aria-describedby="mobile-session-options-description"
            animationClassName="animate-bottom-sheet-content-show motion-reduce:animate-none"
            className="bottom-0 left-0 top-auto max-w-none translate-x-0 translate-y-0 rounded-b-none rounded-t-2xl border-x-0 border-b-0 px-4 pb-safe-area-inset-bottom pt-3"
          >
            <DialogTitle>Session options</DialogTitle>
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-muted-foreground/30" aria-hidden="true" />

            <div className="mb-4 flex items-center gap-3 px-1">
              <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-muted">
                <LLMProviderLogo provider={session.__provider} className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground" title={sessionView.sessionName}>
                  {sessionView.sessionName}
                </p>
                <p id="mobile-session-options-description" className="text-xs text-muted-foreground">
                  {providerLabel} session
                </p>
              </div>
            </div>

            {isEditing ? (
              <div className="mb-3 space-y-2">
                <label htmlFor={`mobile-session-rename-${session.id}`} className="block px-1 text-xs font-medium text-muted-foreground">
                  Session name
                </label>
                <input
                  id={`mobile-session-rename-${session.id}`}
                  type="text"
                  value={renameDraft}
                  onChange={(event) => onRenameDraftChange(event.target.value)}
                  onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.key === 'Enter') {
                      saveMobileRename();
                    }
                  }}
                  className="w-full rounded-xl border-2 border-primary/40 bg-background px-3 py-3 text-foreground shadow-sm focus:border-primary focus:outline-none"
                  autoFocus
                  autoComplete="off"
                  // 16px keeps iOS Safari from zooming the viewport on focus.
                  style={{ fontSize: '16px' }}
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={saveMobileRename}
                    className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground transition-transform active:scale-95"
                  >
                    <Check className="h-5 w-5 flex-shrink-0" />
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={onCancelEditingSession}
                    className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl border border-border bg-muted/35 px-4 py-3 text-sm font-medium text-foreground transition-colors active:bg-muted"
                  >
                    <X className="h-5 w-5 flex-shrink-0" />
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={startMobileRename}
                  className="flex min-h-12 w-full items-center gap-3 rounded-xl border border-border bg-muted/35 px-4 py-3 text-left text-foreground transition-colors active:bg-muted"
                >
                  <Edit2 className="h-5 w-5 flex-shrink-0" />
                  <span className="text-sm font-medium">Rename session</span>
                </button>

                <button
                  type="button"
                  onClick={handleCopyAction}
                  disabled={isCopyPending}
                  className={cn(
                    'flex min-h-12 w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors',
                    copyState === 'copied'
                      ? 'border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-300'
                      : copyState === 'error'
                        ? 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300'
                        : 'border-border bg-muted/35 text-foreground active:bg-muted',
                  )}
                >
                  {isCopyPending ? (
                    <Loader2 className="h-5 w-5 flex-shrink-0 animate-spin" />
                  ) : (
                    <CopyStateIcon className="h-5 w-5 flex-shrink-0" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{copyLabel}</span>
                    {copyState === 'error' && (
                      <span className="mt-0.5 block text-xs">Tap to try again.</span>
                    )}
                  </span>
                </button>

                {!isProcessing && (
                  <button
                    type="button"
                    onClick={() => {
                      setMobileOptionsOpen(false);
                      requestDeleteSession();
                    }}
                    className="flex min-h-12 w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-red-600 transition-colors active:bg-red-500/10 dark:text-red-400"
                  >
                    <Trash2 className="h-5 w-5 flex-shrink-0" />
                    <span className="text-sm font-medium">Archive or delete session</span>
                  </button>
                )}
              </div>
            )}

            {!isEditing && (
              <button
                type="button"
                onClick={() => setMobileOptionsOpen(false)}
                className="mb-3 mt-2 min-h-11 w-full rounded-xl text-sm font-medium text-muted-foreground transition-colors active:bg-muted"
              >
                Cancel
              </button>
            )}
          </DialogContent>
        </Dialog>
      </div>
      )}

      {!isCompact && (
      <div>
        <a
          href={`/session/${session.id}`}
          className={cn(
            buttonVariants({ variant: 'ghost' }),
            'h-auto w-full justify-start rounded-md border bg-card p-2 pr-11 text-left font-normal transition-all duration-150',
            isSelected ? 'border-primary/20 bg-primary/5' : 'border-border/30',
            !isSelected && isProcessing
              ? 'border-border/60 bg-muted/20 hover:bg-muted/25'
              : !isSelected && sessionView.isActive
                ? 'border-green-500/30 bg-green-50/5 hover:bg-green-50/10 dark:bg-green-900/5 dark:hover:bg-green-900/10'
                : 'hover:bg-accent/50',
          )}
          // Left-click keeps in-app navigation; Ctrl/Cmd/middle-click and the
          // native right-click menu use the href to open a new tab/window.
          onClick={(event) => {
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            onSessionSelect(session, project.projectId);
          }}
        >
          <div className="flex w-full min-w-0 items-center gap-2">
            <div
              className={cn(
                'flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md',
                isSelected ? 'bg-primary/10' : 'bg-muted/50',
              )}
            >
              <LLMProviderLogo provider={session.__provider} className="h-3 w-3" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <div
                  className="min-w-0 flex-1 truncate text-sm font-normal text-foreground"
                  title={sessionView.sessionName}
                >
                  {sessionView.sessionName}
                </div>
                {isProcessing ? (
                  <span
                    className={cn(
                      'ml-auto flex-shrink-0 transition-opacity duration-200',
                      isEditing ? 'opacity-0' : 'group-hover:opacity-0',
                    )}
                  >
                    <Tooltip content={t('tooltips.processingSessionIndicator', 'Processing session')} position="top">
                      <span className="flex h-5 w-5 items-center justify-center rounded-md text-muted-foreground">
                        <Loader2 className="h-3 w-3 animate-spin" />
                      </span>
                    </Tooltip>
                  </span>
                ) : compactSessionAge && (
                  <span
                    className={cn(
                      'ml-auto flex-shrink-0 text-[11px] text-muted-foreground transition-opacity duration-200',
                      isEditing ? 'opacity-0' : 'group-hover:opacity-0',
                    )}
                  >
                    {compactSessionAge}
                  </span>
                )}
              </div>
              <div className="mt-0.5 flex items-center">
                {sessionView.messageCount > 0 && <Badge variant="secondary" className="px-1 py-0 text-xs">{sessionView.messageCount}</Badge>}
              </div>
            </div>
          </div>
        </a>

        <SessionOptions
          className="absolute right-2 top-1/2 -translate-y-1/2 transform transition-all duration-200"
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
          onDeleteSession={onDeleteSession}
          onFork={onForkSession ? () => onForkSession(session) : undefined}
          t={t}
        />
      </div>
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
