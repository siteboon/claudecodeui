import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { TFunction } from 'i18next';
import { cn } from '../../../../lib/utils';
import type { Project, ProjectSession } from '../../../../types/app';
import type { SessionWithProvider } from '../../types/types';
import { createSessionViewModel } from '../../utils/utils';
import BranchChip from './BranchChip';

const DEFAULT_VISIBLE = 5;

type RepoSession = SessionWithProvider & { __projectName: string };

type RecentSessionsProps = {
  sessions: RepoSession[];
  selectedSession: ProjectSession | null;
  currentTime: Date;
  /** name → Project lookup so we can show the right branch chip and route clicks. */
  projectsByName: Record<string, Project>;
  onSessionClick: (session: SessionWithProvider, projectName: string) => void;
  t: TFunction;
};

export default function RecentSessions({
  sessions,
  selectedSession,
  currentTime,
  projectsByName,
  onSessionClick,
  t,
}: RecentSessionsProps) {
  const [expanded, setExpanded] = useState(true);
  const [showAll, setShowAll] = useState(false);

  if (sessions.length === 0) {
    return null;
  }

  const visible = showAll ? sessions : sessions.slice(0, DEFAULT_VISIBLE);
  const hidden = sessions.length - visible.length;

  const renderSessionRow = (session: RepoSession) => {
    const project = projectsByName[session.__projectName];
    const branchName = project?.worktreeInfo?.branchName ?? null;
    const origin: 'main' | 'worktree' = project?.isMainWorktree ? 'main' : 'worktree';
    const view = createSessionViewModel(session, currentTime, t);
    const isSelected = selectedSession?.id === session.id;

    return (
      <button
        key={`${session.__projectName}-${session.id}`}
        type="button"
        onClick={() => onSessionClick(session, session.__projectName)}
        className={cn(
          'flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
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
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium text-foreground">
            {view.sessionName}
          </span>
          <span className="block truncate text-[10px] text-muted-foreground">
            {formatRelative(session, currentTime, t)}
            {view.messageCount > 0 && (
              <>
                {' · '}
                {view.messageCount} {t('projects.messages', { defaultValue: 'messages' })}
              </>
            )}
          </span>
        </span>
        <BranchChip branchName={branchName} origin={origin} />
      </button>
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
          <span className="text-muted-foreground/60">· {sessions.length}</span>
        </button>
        {expanded && hidden > 0 && (
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="rounded px-1 text-[10px] font-medium normal-case tracking-normal text-muted-foreground hover:text-foreground"
          >
            {t('projects.showAll', { defaultValue: 'Show all' })} {sessions.length}
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
