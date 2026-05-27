import { useState } from 'react';
import { ChevronDown, ChevronRight, Check, Edit2, Trash2, X } from 'lucide-react';
import type { TFunction } from 'i18next';
import { cn } from '../../../../lib/utils';
import type { Project, ProjectSession, LLMProvider } from '../../../../types/app';
import type { SessionWithProvider } from '../../types/types';
import { createSessionViewModel } from '../../utils/utils';
import BranchChip from './BranchChip';

const DEFAULT_VISIBLE = 5;

type RepoSession = SessionWithProvider & { __projectId: string };

type RecentSessionsProps = {
  sessions: RepoSession[];
  selectedSession: ProjectSession | null;
  currentTime: Date;
  /** projectId → Project lookup so we can show the right branch chip and route clicks. */
  projectsById: Record<string, Project>;
  /** Total session count across this repo (may exceed `sessions.length` if pagination has more). */
  total?: number;
  /** Per-project pagination flags, indexed by projectId. */
  hasMoreByProject?: Record<string, boolean>;
  loadingMoreByProject?: Record<string, boolean>;
  /** Currently-being-renamed session id (controlled by parent). */
  editingSessionId: string | null;
  editingSessionName: string;
  onEditingSessionNameChange: (value: string) => void;
  onStartEditingSession: (sessionId: string, initialName: string) => void;
  onCancelEditingSession: () => void;
  onSaveEditingSession: (
    projectId: string,
    sessionId: string,
    summary: string,
    provider: LLMProvider,
  ) => void;
  onSessionClick: (session: SessionWithProvider, projectId: string) => void;
  onDeleteSession: (
    projectId: string,
    sessionId: string,
    sessionTitle: string,
    provider: LLMProvider,
  ) => void;
  /** Called when user clicks "Show all" — loads the next page across all projects in the repo. */
  onLoadMore?: () => void;
  t: TFunction;
};

export default function RecentSessions({
  sessions,
  selectedSession,
  currentTime,
  projectsById,
  total,
  editingSessionId,
  editingSessionName,
  onEditingSessionNameChange,
  onStartEditingSession,
  onCancelEditingSession,
  onSaveEditingSession,
  onSessionClick,
  onDeleteSession,
  onLoadMore,
  t,
}: RecentSessionsProps) {
  const [expanded, setExpanded] = useState(true);
  const [showAll, setShowAll] = useState(false);

  if (sessions.length === 0) {
    return null;
  }

  const visible = showAll ? sessions : sessions.slice(0, DEFAULT_VISIBLE);
  const knownTotal = typeof total === 'number' && total > sessions.length ? total : sessions.length;
  const hidden = Math.max(0, knownTotal - visible.length);

  const renderSessionRow = (session: RepoSession) => {
    const project = projectsById[session.__projectId];
    const branchName = project?.worktreeInfo?.branchName ?? null;
    const origin: 'main' | 'worktree' = project?.isMainWorktree ? 'main' : 'worktree';
    const view = createSessionViewModel(session, currentTime, t);
    const isSelected = selectedSession?.id === session.id;
    const isEditing = editingSessionId === session.id;

    return (
      <div
        key={`${session.__projectId}-${session.id}`}
        className={cn(
          'group/session relative flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
          'hover:bg-accent/50',
          isSelected && 'bg-accent text-accent-foreground',
        )}
      >
        <span
          className={cn(
            'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full',
            view.isActive
              ? 'bg-green-500 shadow-[0_0_0_3px_rgba(34,197,94,0.15)]'
              : 'bg-muted-foreground/30',
          )}
          aria-hidden
        />
        <button
          type="button"
          disabled={isEditing}
          onClick={() => !isEditing && onSessionClick(session, session.__projectId)}
          className="flex min-w-0 flex-1 flex-col items-start gap-0 text-left disabled:cursor-default"
        >
          {isEditing ? (
            <input
              type="text"
              value={editingSessionName}
              autoFocus
              onChange={(e) => onEditingSessionNameChange(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') {
                  onSaveEditingSession(
                    session.__projectId,
                    session.id,
                    editingSessionName,
                    session.__provider,
                  );
                } else if (e.key === 'Escape') {
                  onCancelEditingSession();
                }
              }}
              className="w-full rounded border border-border bg-background px-1.5 py-0.5 text-xs text-foreground focus:border-primary focus:outline-none"
            />
          ) : (
            <span className="block w-full truncate text-xs font-medium text-foreground">
              {view.sessionName}
            </span>
          )}
          {!isEditing && (
            <span className="block w-full truncate text-[10px] text-muted-foreground">
              {formatRelative(session, currentTime, t)}
              {view.messageCount > 0 && (
                <>
                  {' · '}
                  {view.messageCount} {t('projects.messages', { defaultValue: 'messages' })}
                </>
              )}
            </span>
          )}
        </button>
        {!isEditing && (
          <span className="flex shrink-0 items-center gap-1">
            <span className="opacity-100 transition-opacity group-hover/session:opacity-0">
              <BranchChip branchName={branchName} origin={origin} />
            </span>
            <span className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5 opacity-0 transition-opacity group-hover/session:opacity-100">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onStartEditingSession(session.id, view.sessionName);
                }}
                title={t('tooltips.editSessionName', { defaultValue: 'Rename session' })}
                aria-label={t('tooltips.editSessionName', { defaultValue: 'Rename session' })}
                className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <Edit2 className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteSession(
                    session.__projectId,
                    session.id,
                    view.sessionName,
                    session.__provider,
                  );
                }}
                title={t('tooltips.deleteSession', { defaultValue: 'Delete session' })}
                aria-label={t('tooltips.deleteSession', { defaultValue: 'Delete session' })}
                className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </span>
          </span>
        )}
        {isEditing && (
          <span className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              onClick={() =>
                onSaveEditingSession(
                  session.__projectId,
                  session.id,
                  editingSessionName,
                  session.__provider,
                )
              }
              title={t('tooltips.save', { defaultValue: 'Save' })}
              aria-label={t('tooltips.save', { defaultValue: 'Save' })}
              className="inline-flex h-6 w-6 items-center justify-center rounded text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20"
            >
              <Check className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={onCancelEditingSession}
              title={t('tooltips.cancel', { defaultValue: 'Cancel' })}
              aria-label={t('tooltips.cancel', { defaultValue: 'Cancel' })}
              className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        )}
      </div>
    );
  };

  return (
    <div className="md:space-y-0.5">
      <div className="flex items-center gap-1.5 px-2 py-1">
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          className="flex flex-1 items-center gap-1.5 rounded-md text-[10px] font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
        >
          {expanded ? (
            <ChevronDown className="h-3 w-3 shrink-0" />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0" />
          )}
          <span>{t('projects.recent', { defaultValue: 'Recent' })}</span>
          <span className="text-muted-foreground/60">· {knownTotal}</span>
        </button>
        {expanded && hidden > 0 && (
          <button
            type="button"
            onClick={() => {
              setShowAll(true);
              onLoadMore?.();
            }}
            className="rounded px-1 text-[10px] font-medium normal-case tracking-normal text-muted-foreground hover:text-foreground"
          >
            {t('projects.showAll', { defaultValue: 'Show all' })} {knownTotal}
          </button>
        )}
        {expanded && hidden === 0 && showAll && sessions.length > DEFAULT_VISIBLE && (
          <button
            type="button"
            onClick={() => setShowAll(false)}
            className="rounded px-1 text-[10px] font-medium normal-case tracking-normal text-muted-foreground hover:text-foreground"
          >
            {t('projects.showLess', { defaultValue: 'Show less' })}
          </button>
        )}
      </div>

      {expanded && (
        <div className="space-y-0.5">{visible.map(renderSessionRow)}</div>
      )}
    </div>
  );
}

function formatRelative(session: SessionWithProvider, now: Date, t: TFunction): string {
  const date = new Date(
    session.lastActivity || session.createdAt || 0,
  );
  const diffMs = now.getTime() - date.getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return t('time.justNow', { defaultValue: 'just now' });
  if (minutes < 60) return t('time.minutesAgo', { defaultValue: '{{count}}m ago', count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('time.hoursAgo', { defaultValue: '{{count}}h ago', count: hours });
  const days = Math.floor(hours / 24);
  return t('time.daysAgo', { defaultValue: '{{count}}d ago', count: days });
}
