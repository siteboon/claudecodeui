import { GitFork, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

type NewWorktreeModalProps = {
  isOpen: boolean;
  /** Branch checked out in the main worktree — the default start point. */
  baseBranch: string | null;
  localBranches: string[];
  repositoryRoot: string;
  isCreating: boolean;
  onClose: () => void;
  onCreate: (branch: string, baseBranch: string | null, openAfterCreate: boolean) => Promise<boolean>;
};

/** Client-side preview of the server's branch → folder-name sanitization. */
function sanitizeBranchForFolder(branch: string): string {
  return branch
    .replace(/[/\\:*?"<>|\s]+/g, '-')
    .replace(/\.+$/g, '')
    .replace(/^-+|-+$/g, '');
}

function repositoryName(repositoryRoot: string): string {
  const segments = repositoryRoot.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] ?? repositoryRoot;
}

export default function NewWorktreeModal({
  isOpen,
  baseBranch,
  localBranches,
  repositoryRoot,
  isCreating,
  onClose,
  onCreate,
}: NewWorktreeModalProps) {
  const [branchName, setBranchName] = useState('');
  const [selectedBaseBranch, setSelectedBaseBranch] = useState('');
  const [openAfterCreate, setOpenAfterCreate] = useState(true);

  useEffect(() => {
    if (!isOpen) {
      setBranchName('');
      setOpenAfterCreate(true);
    } else {
      setSelectedBaseBranch(baseBranch ?? '');
    }
  }, [isOpen, baseBranch]);

  const trimmedBranch = branchName.trim();
  const branchExists = localBranches.includes(trimmedBranch);

  const folderPreview = useMemo(() => {
    if (!trimmedBranch) {
      return null;
    }
    const folder = sanitizeBranchForFolder(trimmedBranch);
    return folder ? `${repositoryName(repositoryRoot)}-worktrees/${folder}` : null;
  }, [repositoryRoot, trimmedBranch]);

  const handleCreate = async (): Promise<boolean> => {
    if (!trimmedBranch) {
      return false;
    }

    const success = await onCreate(
      trimmedBranch,
      branchExists ? null : selectedBaseBranch || null,
      openAfterCreate,
    );
    if (success) {
      onClose();
    }
    return success;
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div
        className="relative w-full max-w-md overflow-hidden rounded-xl border border-border bg-card shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-worktree-title"
      >
        <div className="p-6">
          <h3 id="new-worktree-title" className="mb-1 text-lg font-semibold text-foreground">
            New Worktree
          </h3>
          <p className="mb-4 text-sm text-muted-foreground">
            Check out a branch in its own folder and work on it in parallel.
          </p>

          <div className="mb-4">
            <label htmlFor="worktree-branch-name" className="mb-2 block text-sm font-medium text-foreground/80">
              Branch
            </label>
            <input
              id="worktree-branch-name"
              type="text"
              value={branchName}
              onChange={(event) => setBranchName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !isCreating) {
                  event.preventDefault();
                  event.stopPropagation();
                  void handleCreate();
                  return;
                }

                if (event.key === 'Escape' && !isCreating) {
                  event.preventDefault();
                  event.stopPropagation();
                  onClose();
                }
              }}
              placeholder="feature/new-feature"
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-foreground placeholder:text-muted-foreground focus:border-primary/30 focus:outline-none focus:ring-2 focus:ring-primary/20"
              autoFocus
            />
            {branchExists && (
              <p className="mt-1.5 text-xs text-muted-foreground">
                Existing branch — it will be checked out as-is.
              </p>
            )}
          </div>

          {!branchExists && (
            <div className="mb-4">
              <label htmlFor="worktree-base-branch" className="mb-2 block text-sm font-medium text-foreground/80">
                Create from
              </label>
              <select
                id="worktree-base-branch"
                value={selectedBaseBranch}
                onChange={(event) => setSelectedBaseBranch(event.target.value)}
                className="w-full rounded-xl border border-border bg-background px-3 py-2 text-foreground focus:border-primary/30 focus:outline-none focus:ring-2 focus:ring-primary/20"
              >
                {localBranches.map((branch) => (
                  <option key={branch} value={branch}>
                    {branch}
                  </option>
                ))}
              </select>
            </div>
          )}

          {folderPreview && (
            <p className="mb-4 rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
              Will be created in <span className="font-mono text-foreground/80">{folderPreview}</span>
            </p>
          )}

          <label className="mb-4 flex cursor-pointer items-center gap-2 text-sm text-foreground/80">
            <input
              type="checkbox"
              checked={openAfterCreate}
              onChange={(event) => setOpenAfterCreate(event.target.checked)}
              className="h-4 w-4 rounded border-border accent-primary"
            />
            Switch to the worktree after creating it
          </label>

          <div className="flex justify-end space-x-3">
            <button
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              Cancel
            </button>
            <button
              onClick={() => void handleCreate()}
              disabled={!trimmedBranch || isCreating}
              className="flex items-center space-x-2 rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isCreating ? (
                <>
                  <RefreshCw className="h-3 w-3 animate-spin" />
                  <span>Creating...</span>
                </>
              ) : (
                <>
                  <GitFork className="h-3 w-3" />
                  <span>Create Worktree</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
