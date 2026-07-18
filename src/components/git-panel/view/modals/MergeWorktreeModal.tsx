import { ArrowRight, GitMerge, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { MergeWorktreeOptions, WorktreeInfo } from '../../types/types';

type MergeWorktreeModalProps = {
  /** Worktree being merged; null keeps the modal closed. */
  worktree: WorktreeInfo | null;
  /** Merge target — the branch checked out in the main worktree. */
  baseBranch: string | null;
  isMerging: boolean;
  onClose: () => void;
  onMerge: (worktreePath: string, options: MergeWorktreeOptions) => Promise<boolean>;
};

function defaultMessage(branch: string | null, squash: boolean): string {
  if (!branch) {
    return '';
  }
  return squash ? `Squash merge branch '${branch}'` : `Merge branch '${branch}'`;
}

export default function MergeWorktreeModal({
  worktree,
  baseBranch,
  isMerging,
  onClose,
  onMerge,
}: MergeWorktreeModalProps) {
  const [squash, setSquash] = useState(true);
  const [message, setMessage] = useState('');
  const [removeAfterMerge, setRemoveAfterMerge] = useState(true);
  /** Tracks whether the user edited the message, so toggling squash only rewrites untouched defaults. */
  const [messageEdited, setMessageEdited] = useState(false);

  useEffect(() => {
    if (worktree) {
      setSquash(true);
      setRemoveAfterMerge(true);
      setMessage(defaultMessage(worktree.branch, true));
      setMessageEdited(false);
    }
  }, [worktree]);

  const handleSquashChange = (nextSquash: boolean) => {
    setSquash(nextSquash);
    if (!messageEdited) {
      setMessage(defaultMessage(worktree?.branch ?? null, nextSquash));
    }
  };

  const handleMerge = async () => {
    if (!worktree) {
      return;
    }

    const success = await onMerge(worktree.path, {
      squash,
      message: message.trim(),
      removeAfterMerge,
    });
    if (success) {
      onClose();
    }
  };

  if (!worktree) {
    return null;
  }

  const commitLabel = `${worktree.ahead} commit${worktree.ahead === 1 ? '' : 's'}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div
        className="relative w-full max-w-md overflow-hidden rounded-xl border border-border bg-card shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="merge-worktree-title"
      >
        <div className="p-6">
          <h3 id="merge-worktree-title" className="mb-1 text-lg font-semibold text-foreground">
            Merge Worktree
          </h3>

          {/* branch → base branch summary */}
          <div className="mb-4 flex items-center gap-2 text-sm">
            <span className="max-w-[45%] truncate rounded-md bg-primary/10 px-2 py-1 font-mono text-primary">
              {worktree.branch}
            </span>
            <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="max-w-[45%] truncate rounded-md bg-muted px-2 py-1 font-mono text-foreground/80">
              {baseBranch}
            </span>
            <span className="ml-auto shrink-0 text-xs text-muted-foreground">{commitLabel}</span>
          </div>

          <label className="mb-3 flex cursor-pointer items-start gap-2 text-sm text-foreground/80">
            <input
              type="checkbox"
              checked={squash}
              onChange={(event) => handleSquashChange(event.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-border accent-primary"
            />
            <span>
              Squash commits
              <span className="block text-xs text-muted-foreground">
                Combine all {commitLabel} into a single commit on {baseBranch}
              </span>
            </span>
          </label>

          <div className="mb-3">
            <label htmlFor="merge-worktree-message" className="mb-2 block text-sm font-medium text-foreground/80">
              Commit message
            </label>
            <textarea
              id="merge-worktree-message"
              value={message}
              onChange={(event) => {
                setMessage(event.target.value);
                setMessageEdited(true);
              }}
              rows={2}
              className="w-full resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/30 focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>

          <label className="mb-4 flex cursor-pointer items-start gap-2 text-sm text-foreground/80">
            <input
              type="checkbox"
              checked={removeAfterMerge}
              onChange={(event) => setRemoveAfterMerge(event.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-border accent-primary"
            />
            <span>
              Clean up after merge
              <span className="block text-xs text-muted-foreground">
                Remove the worktree and delete its branch once merged
              </span>
            </span>
          </label>

          <div className="flex justify-end space-x-3">
            <button
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              Cancel
            </button>
            <button
              onClick={() => void handleMerge()}
              disabled={isMerging || !message.trim()}
              className="flex items-center space-x-2 rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isMerging ? (
                <>
                  <RefreshCw className="h-3 w-3 animate-spin" />
                  <span>Merging...</span>
                </>
              ) : (
                <>
                  <GitMerge className="h-3 w-3" />
                  <span>{squash ? 'Squash & Merge' : 'Merge'}</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
