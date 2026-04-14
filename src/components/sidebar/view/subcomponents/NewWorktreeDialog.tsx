/**
 * NewWorktreeDialog
 *
 * A modal dialog that lets the user create a new git linked worktree for the
 * currently selected project and immediately open a new session in it.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { GitBranch, X } from 'lucide-react';
import type { TFunction } from 'i18next';
import { Button } from '../../../../shared/view/ui';
import { api } from '../../../../utils/api';
import type { Project } from '../../../../types/app';

type NewWorktreeDialogProps = {
  project: Project;
  onClose: () => void;
  onCreated: (worktreePath: string) => void;
  t: TFunction;
};

export default function NewWorktreeDialog({ project, onClose, onCreated, t }: NewWorktreeDialogProps) {
  const [branchName, setBranchName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleSubmit = useCallback(async () => {
    const branch = branchName.trim();
    if (!branch) { setError('Branch name is required'); return; }

    setIsCreating(true);
    setError(null);

    try {
      const response = await api.createWorktree(project.name, branch);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to create worktree');
      onCreated(data.worktreePath as string);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setIsCreating(false);
    }
  }, [branchName, project.name, onCreated]);

  const modal = (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-md rounded-xl border border-border bg-background shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-emerald-500" />
            <h2 className="text-sm font-semibold text-foreground">
              New worktree — {project.displayName}
            </h2>
          </div>
          <button
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-3">
          <p className="text-xs text-muted-foreground">
            Creates a new git worktree as a sibling directory so you can work on a separate
            branch in parallel. A new session will open in the worktree automatically.
          </p>

          <div className="space-y-1">
            <label className="text-xs font-medium text-foreground" htmlFor="worktree-branch">
              Branch name
            </label>
            <input
              id="worktree-branch"
              ref={inputRef}
              type="text"
              value={branchName}
              onChange={(e) => { setBranchName(e.target.value); setError(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter' && !isCreating) handleSubmit(); }}
              placeholder="feature/my-feature"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              autoComplete="off"
              spellCheck={false}
            />
            <p className="text-[10px] text-muted-foreground">
              If the branch already exists it will be checked out; otherwise a new branch is created.
            </p>
          </div>

          {error && (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
              {error}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <Button variant="outline" size="sm" onClick={onClose} disabled={isCreating}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={isCreating || !branchName.trim()}
            className="gap-1.5"
          >
            {isCreating ? (
              <>
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                Creating…
              </>
            ) : (
              <>
                <GitBranch className="h-3.5 w-3.5" />
                Create worktree
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );

  return ReactDOM.createPortal(modal, document.body);
}
