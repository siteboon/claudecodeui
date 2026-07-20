import {
  ArrowRightLeft,
  Check,
  GitFork,
  GitMerge,
  Home,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react';
import { useState } from 'react';

import type { Project } from '../../../../types/app';
import { useWorktreesController } from '../../hooks/useWorktreesController';
import type { WorktreeInfo } from '../../types/types';
import MergeWorktreeModal from '../modals/MergeWorktreeModal';
import NewWorktreeModal from '../modals/NewWorktreeModal';
import RemoveWorktreeModal from '../modals/RemoveWorktreeModal';

type WorktreesViewProps = {
  isMobile: boolean;
  selectedProject: Project | null;
  localBranches: string[];
  onProjectSelect?: (project: Project) => void;
  onProjectsRefresh?: () => void;
};

/** Shortens an absolute worktree path to "container/folder" for display. */
function shortWorktreePath(worktreePath: string): string {
  const segments = worktreePath.split(/[\\/]/).filter(Boolean);
  return segments.slice(-2).join('/') || worktreePath;
}

// ---------------------------------------------------------------------------
// Worktree row
// ---------------------------------------------------------------------------

type WorktreeRowProps = {
  worktree: WorktreeInfo;
  isMobile: boolean;
  isBusy: boolean;
  onOpen: () => void;
  onMerge: () => void;
  onRemove: () => void;
};

function WorktreeRow({ worktree, isMobile, isBusy, onOpen, onMerge, onRemove }: WorktreeRowProps) {
  const branchLabel = worktree.branch
    ?? (worktree.headSha ? `detached @ ${worktree.headSha.slice(0, 7)}` : 'detached');

  return (
    <div
      className={`group flex items-center gap-3 border-b border-border/40 px-4 transition-colors hover:bg-accent/40 ${
        isMobile ? 'py-2.5' : 'py-3'
      } ${worktree.isCurrent ? 'bg-primary/5' : ''}`}
    >
      {/* Worktree icon — house for the main checkout, fork for linked worktrees */}
      <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md border ${
        worktree.isCurrent
          ? 'border-primary/30 bg-primary/10 text-primary'
          : 'border-border bg-muted/50 text-muted-foreground'
      }`}>
        {worktree.isMain ? <Home className="h-3.5 w-3.5" /> : <GitFork className="h-3.5 w-3.5" />}
      </div>

      {/* Name + status line */}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <span className={`truncate text-sm font-medium ${worktree.isCurrent ? 'text-foreground' : 'text-foreground/80'}`}>
            {branchLabel}
          </span>
          {worktree.isCurrent && (
            <span className="shrink-0 rounded-full bg-primary/15 px-1.5 py-0.5 text-xs font-semibold text-primary">
              current
            </span>
          )}
          {worktree.isMain && (
            <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
              main worktree
            </span>
          )}
          {worktree.isLocked && (
            <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
              locked
            </span>
          )}
        </div>

        <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          <span className="shrink-0 font-mono">{shortWorktreePath(worktree.path)}</span>
          {worktree.ahead > 0 && (
            <span className="shrink-0 text-green-600 dark:text-green-400">↑{worktree.ahead}</span>
          )}
          {worktree.behind > 0 && (
            <span className="shrink-0 text-primary">↓{worktree.behind}</span>
          )}
          {worktree.changedFileCount > 0 && (
            <span className="shrink-0 text-amber-600 dark:text-amber-400">
              ● {worktree.changedFileCount} change{worktree.changedFileCount === 1 ? '' : 's'}
            </span>
          )}
          {worktree.lastCommitSubject && (
            <span className="truncate">{worktree.lastCommitSubject}</span>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className={`flex shrink-0 items-center gap-1 ${
        worktree.isCurrent || isBusy
          ? 'opacity-100'
          : 'opacity-100 sm:opacity-0 sm:focus-within:opacity-100 sm:group-hover:opacity-100'
      } transition-opacity`}>
        {isBusy ? (
          <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : worktree.isCurrent ? (
          <Check className="h-4 w-4 text-primary" />
        ) : (
          <>
            <button
              onClick={onOpen}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              title={`Switch to ${branchLabel}`}
            >
              <ArrowRightLeft className="h-3 w-3" />
              Open
            </button>
            {!worktree.isMain && (
              <>
                <button
                  onClick={onMerge}
                  disabled={!worktree.branch || worktree.ahead === 0}
                  className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
                  title={
                    worktree.ahead === 0
                      ? 'Nothing to merge — no commits ahead of the base branch'
                      : `Merge ${branchLabel} into the base branch`
                  }
                >
                  <GitMerge className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={onRemove}
                  className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                  title={`Remove worktree for ${branchLabel}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// WorktreesView
// ---------------------------------------------------------------------------

export default function WorktreesView({
  isMobile,
  selectedProject,
  localBranches,
  onProjectSelect,
  onProjectsRefresh,
}: WorktreesViewProps) {
  const {
    worktreeData,
    isLoading,
    isCreatingWorktree,
    busyWorktreePath,
    actionError,
    clearActionError,
    refreshWorktrees,
    createWorktree,
    openWorktree,
    mergeWorktree,
    removeWorktree,
  } = useWorktreesController({ selectedProject, onProjectSelect, onProjectsRefresh });

  const [showNewWorktreeModal, setShowNewWorktreeModal] = useState(false);
  const [mergeTarget, setMergeTarget] = useState<WorktreeInfo | null>(null);
  const [removeTarget, setRemoveTarget] = useState<WorktreeInfo | null>(null);

  const worktrees = worktreeData?.worktrees ?? [];
  const linkedWorktreeCount = worktrees.filter((worktree) => !worktree.isMain).length;

  if (isLoading && worktrees.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center">
        <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header row: count + create button */}
      <div className="flex items-center justify-between border-b border-border/40 px-4 py-2.5">
        <span className="text-sm text-muted-foreground">
          {linkedWorktreeCount === 0
            ? 'No worktrees'
            : `${linkedWorktreeCount} worktree${linkedWorktreeCount === 1 ? '' : 's'}`}
        </span>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => void refreshWorktrees()}
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            title="Refresh worktrees"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => setShowNewWorktreeModal(true)}
            disabled={!worktreeData}
            className="flex items-center gap-1.5 rounded-lg bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary transition-colors hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" />
            New worktree
          </button>
        </div>
      </div>

      {/* Action error banner */}
      {actionError && (
        <div className="flex items-start gap-2 border-b border-destructive/30 bg-destructive/10 px-4 py-2.5">
          <p className="min-w-0 flex-1 break-words text-xs text-destructive">{actionError}</p>
          <button
            onClick={clearActionError}
            className="shrink-0 text-destructive/70 transition-colors hover:text-destructive"
            title="Dismiss"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Worktree list */}
      <div className="flex-1 overflow-y-auto">
        {worktrees.map((worktree) => (
          <WorktreeRow
            key={worktree.path}
            worktree={worktree}
            isMobile={isMobile}
            isBusy={busyWorktreePath === worktree.path}
            onOpen={() => void openWorktree(worktree.path)}
            onMerge={() => setMergeTarget(worktree)}
            onRemove={() => setRemoveTarget(worktree)}
          />
        ))}

        {/* Explainer under the list while only the main worktree exists */}
        {linkedWorktreeCount === 0 && (
          <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
            <GitFork className="h-10 w-10 text-muted-foreground opacity-30" />
            <div>
              <p className="text-sm font-medium text-foreground/80">Work on branches in parallel</p>
              <p className="mx-auto mt-1 max-w-xs text-xs text-muted-foreground">
                A worktree checks out a branch in its own folder, so you can run separate chat
                sessions side by side and merge the results back when they're ready.
              </p>
            </div>
            <button
              onClick={() => setShowNewWorktreeModal(true)}
              disabled={!worktreeData}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" />
              Create your first worktree
            </button>
          </div>
        )}
      </div>

      <NewWorktreeModal
        isOpen={showNewWorktreeModal}
        baseBranch={worktreeData?.baseBranch ?? null}
        localBranches={localBranches}
        repositoryRoot={worktreeData?.repositoryRoot ?? ''}
        isCreating={isCreatingWorktree}
        onClose={() => setShowNewWorktreeModal(false)}
        onCreate={createWorktree}
      />

      <MergeWorktreeModal
        worktree={mergeTarget}
        baseBranch={worktreeData?.baseBranch ?? null}
        isMerging={mergeTarget !== null && busyWorktreePath === mergeTarget.path}
        onClose={() => setMergeTarget(null)}
        onMerge={mergeWorktree}
      />

      <RemoveWorktreeModal
        worktree={removeTarget}
        isRemoving={removeTarget !== null && busyWorktreePath === removeTarget.path}
        onClose={() => setRemoveTarget(null)}
        onRemove={removeWorktree}
      />
    </div>
  );
}
