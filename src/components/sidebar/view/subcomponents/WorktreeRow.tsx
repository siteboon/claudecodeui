import { ChevronRight, Plus, Trash2 } from 'lucide-react';
import type { TFunction } from 'i18next';
import { cn } from '../../../../lib/utils';
import type { Project } from '../../../../types/app';
import BranchChip from './BranchChip';

type WorktreeRowProps = {
  project: Project;
  isActive: boolean;
  sessionCount: number;
  lastActivityLabel: string | null;
  onOpen: (project: Project) => void;
  onNewSessionInWorktree: (project: Project) => void;
  onDelete: (project: Project) => void;
  t: TFunction;
};

export default function WorktreeRow({
  project,
  isActive,
  sessionCount,
  lastActivityLabel,
  onOpen,
  onNewSessionInWorktree,
  onDelete,
  t,
}: WorktreeRowProps) {
  const isDormant = sessionCount === 0;
  const isStale = Boolean(project.isStale);
  const isMuted = isDormant || isStale;

  const metaText = isStale
    ? t('projects.staleWorktree', { defaultValue: 'archived' })
    : isDormant
      ? t('projects.emptyWorktree', { defaultValue: 'empty · click to start' })
      : `${sessionCount} ${t('projects.sessionsShort', {
          defaultValue: sessionCount === 1 ? 'session' : 'sessions',
          count: sessionCount,
        })}${lastActivityLabel ? ` · ${lastActivityLabel}` : ''}`;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(project)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen(project);
        }
      }}
      className={cn(
        'group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 transition-colors',
        'hover:bg-accent/50',
        isActive && 'bg-accent text-accent-foreground',
        isMuted && 'opacity-60',
      )}
      title={project.fullPath}
    >
      <BranchChip branchName={project.worktreeInfo?.branchName ?? project.displayName} />
      <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
        {metaText}
      </span>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onNewSessionInWorktree(project);
        }}
        className={cn(
          'flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-opacity',
          'opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-accent hover:text-foreground',
        )}
        title={t('tooltips.newSessionInWorktree', {
          defaultValue: 'New session in this worktree',
        })}
        aria-label={t('tooltips.newSessionInWorktree', {
          defaultValue: 'New session in this worktree',
        })}
      >
        <Plus className="h-3 w-3" />
      </button>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onDelete(project);
        }}
        className={cn(
          'flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-opacity',
          'opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-400',
        )}
        title={t('tooltips.deleteWorktree', { defaultValue: 'Delete worktree' })}
        aria-label={t('tooltips.deleteWorktree', { defaultValue: 'Delete worktree' })}
      >
        <Trash2 className="h-3 w-3" />
      </button>
      <ChevronRight
        className={cn(
          'h-3 w-3 text-muted-foreground/60 transition-opacity',
          'opacity-0 group-hover:opacity-100',
        )}
        aria-hidden
      />
    </div>
  );
}
