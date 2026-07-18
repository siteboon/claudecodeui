import { RefreshCw, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { RemoveWorktreeOptions, WorktreeInfo } from '../../types/types';

type RemoveWorktreeModalProps = {
  /** Worktree being removed; null keeps the modal closed. */
  worktree: WorktreeInfo | null;
  isRemoving: boolean;
  onClose: () => void;
  onRemove: (worktreePath: string, options: RemoveWorktreeOptions) => Promise<boolean>;
};

export default function RemoveWorktreeModal({
  worktree,
  isRemoving,
  onClose,
  onRemove,
}: RemoveWorktreeModalProps) {
  const [deleteBranch, setDeleteBranch] = useState(true);
  const [force, setForce] = useState(false);

  useEffect(() => {
    if (worktree) {
      setDeleteBranch(true);
      setForce(false);
    }
  }, [worktree]);

  const handleRemove = async () => {
    if (!worktree) {
      return;
    }

    const success = await onRemove(worktree.path, { force, deleteBranch });
    if (success) {
      onClose();
    }
  };

  if (!worktree) {
    return null;
  }

  const isDirty = worktree.changedFileCount > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div
        className="relative w-full max-w-md overflow-hidden rounded-xl border border-border bg-card shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="remove-worktree-title"
      >
        <div className="p-6">
          <div className="mb-4 flex items-center">
            <div className="mr-3 rounded-full bg-red-100 p-2 dark:bg-red-900/30">
              <Trash2 className="h-4 w-4 text-red-600 dark:text-red-400" />
            </div>
            <h3 id="remove-worktree-title" className="text-lg font-semibold text-foreground">
              Remove Worktree
            </h3>
          </div>

          <p className="mb-3 text-sm text-muted-foreground">
            Remove the worktree for{' '}
            <span className="font-mono text-foreground/80">{worktree.branch ?? 'detached HEAD'}</span>?
            Its folder is deleted and the linked project is archived — chat sessions stay recoverable.
          </p>

          {isDirty && (
            <p className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
              This worktree has {worktree.changedFileCount} uncommitted change
              {worktree.changedFileCount === 1 ? '' : 's'} that will be lost.
            </p>
          )}

          {worktree.branch && (
            <label className="mb-2 flex cursor-pointer items-center gap-2 text-sm text-foreground/80">
              <input
                type="checkbox"
                checked={deleteBranch}
                onChange={(event) => setDeleteBranch(event.target.checked)}
                className="h-4 w-4 rounded border-border accent-primary"
              />
              Also delete branch <span className="font-mono">{worktree.branch}</span>
            </label>
          )}

          {isDirty && (
            <label className="mb-2 flex cursor-pointer items-center gap-2 text-sm text-foreground/80">
              <input
                type="checkbox"
                checked={force}
                onChange={(event) => setForce(event.target.checked)}
                className="h-4 w-4 rounded border-border accent-primary"
              />
              Discard uncommitted changes
            </label>
          )}

          <div className="mt-4 flex justify-end space-x-3">
            <button
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              Cancel
            </button>
            <button
              onClick={() => void handleRemove()}
              disabled={isRemoving || (isDirty && !force)}
              className="flex items-center space-x-2 rounded-lg bg-red-600 px-4 py-2 text-sm text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isRemoving ? (
                <>
                  <RefreshCw className="h-3 w-3 animate-spin" />
                  <span>Removing...</span>
                </>
              ) : (
                <>
                  <Trash2 className="h-3 w-3" />
                  <span>Remove</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
