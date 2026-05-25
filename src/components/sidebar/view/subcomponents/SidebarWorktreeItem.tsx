import { useState } from 'react';
import { ChevronDown, ChevronRight, GitBranch, Loader2, Lock, Plus, Trash2 } from 'lucide-react';
import type { TFunction } from 'i18next';

import { Button } from '../../../../shared/view/ui';
import { cn } from '../../../../lib/utils';
import type { Project, ProjectSession, LLMProvider, Worktree } from '../../../../types/app';
import type { SessionWithProvider } from '../../types/types';

import SidebarSessionItem from './SidebarSessionItem';

type WorktreeMutationResult =
  | { ok: true }
  | { ok: false; error: { code: string; message: string } };

type SidebarWorktreeItemProps = {
  project: Project;
  worktree: Worktree;
  sessions: SessionWithProvider[];
  isExpanded: boolean;
  isSelected: boolean;
  selectedSession: ProjectSession | null;
  currentTime: Date;
  editingSession: string | null;
  editingSessionName: string;
  onToggleWorktree: (worktreePath: string) => void;
  onWorktreeSelect: (project: Project, worktree: Worktree) => void;
  onWorktreeNewSession: (project: Project, worktree: Worktree) => void;
  onRemoveWorktree: (projectId: string, worktreePath: string, force?: boolean) => Promise<WorktreeMutationResult>;
  allWorktrees: Worktree[];
  onOpenSessionInWorktree: (session: SessionWithProvider, project: Project, worktree: Worktree) => void;
  onSessionSelect: (session: SessionWithProvider, projectId: string) => void;
  onDeleteSession: (
    projectId: string,
    sessionId: string,
    sessionTitle: string,
    provider: LLMProvider,
  ) => void;
  onEditingSessionNameChange: (value: string) => void;
  onStartEditingSession: (sessionId: string, initialName: string) => void;
  onCancelEditingSession: () => void;
  onSaveEditingSession: (projectId: string, sessionId: string, summary: string, provider: LLMProvider) => void;
  t: TFunction;
};

function buildWorktreeProject(project: Project, worktree: Worktree): Project {
  return {
    ...project,
    path: worktree.path,
    fullPath: worktree.path,
    sessions: worktree.sessions,
    cursorSessions: worktree.cursorSessions,
    codexSessions: worktree.codexSessions,
    geminiSessions: worktree.geminiSessions,
  };
}

export default function SidebarWorktreeItem({
  project,
  worktree,
  sessions,
  isExpanded,
  isSelected,
  selectedSession,
  currentTime,
  editingSession,
  editingSessionName,
  onToggleWorktree,
  onWorktreeSelect,
  onWorktreeNewSession,
  onRemoveWorktree,
  allWorktrees,
  onOpenSessionInWorktree,
  onSessionSelect,
  onDeleteSession,
  onEditingSessionNameChange,
  onStartEditingSession,
  onCancelEditingSession,
  onSaveEditingSession,
  t,
}: SidebarWorktreeItemProps) {
  const [confirmState, setConfirmState] = useState<'idle' | 'confirm' | 'deleting' | 'dirty'>('idle');
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const branchLabel = worktree.branch ?? 'detached';
  const worktreeName = worktree.path.split('/').filter(Boolean).pop() || worktree.path;
  const canDelete = !worktree.isMain;

  const handleRowClick = () => {
    onWorktreeSelect(project, worktree);
    onToggleWorktree(worktree.path);
  };

  const worktreeProject = buildWorktreeProject(project, worktree);

  const performRemove = async (force: boolean) => {
    setConfirmState('deleting');
    setDeleteError(null);
    try {
      const result = await onRemoveWorktree(project.projectId, worktree.path, force);
      if (result.ok) {
        setConfirmState('idle');
        return;
      }
      if (result.error.code === 'WORKTREE_DIRTY') {
        setConfirmState('dirty');
      } else {
        setConfirmState('confirm');
      }
      setDeleteError(result.error.message);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setConfirmState('confirm');
      setDeleteError(`Unexpected error: ${message}`);
    }
  };

  return (
    <div className="space-y-1">
      <div className="group/wt flex items-stretch">
        <Button
          variant="ghost"
          className={cn(
            'flex-1 h-auto justify-between p-2 font-normal hover:bg-accent/50',
            isSelected && 'bg-accent text-accent-foreground',
          )}
          onClick={handleRowClick}
        >
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <GitBranch className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1 text-left">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-sm font-medium text-foreground" title={worktree.path}>
                  {worktreeName}
                </span>
                {worktree.isMain && (
                  <span className="rounded bg-primary/10 px-1 py-px text-[10px] font-medium uppercase tracking-wide text-primary">
                    main
                  </span>
                )}
                {worktree.isLocked && (
                  <Lock className="h-3 w-3 text-muted-foreground" aria-label="locked" />
                )}
              </div>
              <div className="truncate text-xs text-muted-foreground" title={branchLabel}>
                {branchLabel}
              </div>
            </div>
          </div>
          <div className="flex flex-shrink-0 items-center">
            {isExpanded ? (
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            )}
          </div>
        </Button>

        {canDelete && confirmState === 'idle' && (
          <button
            className="touch:opacity-100 flex w-7 flex-shrink-0 items-center justify-center rounded opacity-0 transition-all duration-200 hover:bg-red-50 group-hover/wt:opacity-100 dark:hover:bg-red-900/20"
            onClick={(event) => {
              event.stopPropagation();
              setConfirmState('confirm');
              setDeleteError(null);
            }}
            title="Delete worktree"
          >
            <Trash2 className="h-3.5 w-3.5 text-red-600 dark:text-red-400" />
          </button>
        )}
      </div>

      {(confirmState === 'confirm' || confirmState === 'deleting' || confirmState === 'dirty') && (
        <div className="space-y-1.5 rounded-md border border-red-200 bg-red-50/50 p-2 dark:border-red-900/50 dark:bg-red-900/10">
          <p className="text-[11px] text-red-700 dark:text-red-300">
            {confirmState === 'dirty'
              ? 'Worktree has uncommitted changes. Force delete?'
              : `Delete worktree "${worktreeName}"?`}
          </p>
          {deleteError && confirmState !== 'dirty' && (
            <p className="text-[11px] text-red-600 dark:text-red-400">{deleteError}</p>
          )}
          <div className="flex gap-1.5">
            <button
              className="inline-flex items-center gap-1 rounded bg-red-600 px-2 py-1 text-[11px] font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
              onClick={(event) => {
                event.stopPropagation();
                void performRemove(confirmState === 'dirty');
              }}
              disabled={confirmState === 'deleting'}
            >
              {confirmState === 'deleting' && <Loader2 className="h-3 w-3 animate-spin" />}
              {confirmState === 'deleting'
                ? 'Deleting…'
                : confirmState === 'dirty'
                  ? 'Force delete'
                  : 'Delete'}
            </button>
            <button
              className="rounded border border-border bg-card px-2 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-50"
              onClick={(event) => {
                event.stopPropagation();
                setConfirmState('idle');
                setDeleteError(null);
              }}
              disabled={confirmState === 'deleting'}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {isExpanded && (
        <div className="ml-3 space-y-1 border-l border-border/60 pl-3">
          <Button
            variant="default"
            size="sm"
            className="h-8 w-full justify-start gap-2 bg-primary text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            onClick={(event) => {
              event.stopPropagation();
              onWorktreeNewSession(project, worktree);
            }}
          >
            <Plus className="h-3 w-3" />
            {t('sessions.newSession')}
          </Button>

          {sessions.length === 0 ? (
            <div className="px-3 py-2 text-left">
              <p className="text-xs text-muted-foreground">{t('sessions.noSessions')}</p>
            </div>
          ) : (
            sessions.map((session) => (
              <SidebarSessionItem
                key={session.id}
                project={worktreeProject}
                session={session}
                selectedSession={selectedSession}
                currentTime={currentTime}
                editingSession={editingSession}
                editingSessionName={editingSessionName}
                onEditingSessionNameChange={onEditingSessionNameChange}
                onStartEditingSession={onStartEditingSession}
                onCancelEditingSession={onCancelEditingSession}
                onSaveEditingSession={onSaveEditingSession}
                onProjectSelect={() => onWorktreeSelect(project, worktree)}
                onSessionSelect={onSessionSelect}
                onDeleteSession={onDeleteSession}
                worktreesForOpenIn={allWorktrees}
                onOpenSessionInWorktree={(s, _p, w) => onOpenSessionInWorktree(s, project, w)}
                t={t}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}
