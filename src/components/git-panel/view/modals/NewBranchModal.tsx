import { Plus, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';

type NewBranchModalProps = {
  isOpen: boolean;
  currentBranch: string;
  isCreatingBranch: boolean;
  onClose: () => void;
  onCreateBranch: (branchName: string) => Promise<boolean>;
};

export default function NewBranchModal({
  isOpen,
  currentBranch,
  isCreatingBranch,
  onClose,
  onCreateBranch,
}: NewBranchModalProps) {
  const [newBranchName, setNewBranchName] = useState('');

  useEffect(() => {
    if (!isOpen) {
      setNewBranchName('');
    }
  }, [isOpen]);

  const handleCreateBranch = async (): Promise<boolean> => {
    const branchName = newBranchName.trim();
    if (!branchName) {
      return false;
    }

    try {
      const success = await onCreateBranch(branchName);
      if (success) {
        setNewBranchName('');
        onClose();
      }
      return success;
    } catch (error) {
      console.error('Failed to create branch:', error);
      return false;
    }
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div
        className="relative bg-card border border-border rounded-xl shadow-2xl max-w-md w-full overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-branch-title"
      >
        <div className="p-6">
          <h3 className="text-lg font-semibold text-foreground mb-4">Create New Branch</h3>

          <div className="mb-4">
            <label htmlFor="git-new-branch-name" className="block text-sm font-medium text-foreground/80 mb-2">
              Branch Name
            </label>
            <input
              id="git-new-branch-name"
              type="text"
              value={newBranchName}
              onChange={(event) => setNewBranchName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !isCreatingBranch) {
                  void handleCreateBranch();
                }
              }}
              placeholder="feature/new-feature"
              className="w-full px-3 py-2 border border-border rounded-xl bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/30"
              autoFocus
            />
          </div>

          <p className="text-sm text-muted-foreground mb-4">
            This will create a new branch from the current branch ({currentBranch})
          </p>

          <div className="flex justify-end space-x-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-accent rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => void handleCreateBranch()}
              disabled={!newBranchName.trim() || isCreatingBranch}
              className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2 transition-colors"
            >
              {isCreatingBranch ? (
                <>
                  <RefreshCw className="w-3 h-3 animate-spin" />
                  <span>Creating...</span>
                </>
              ) : (
                <>
                  <Plus className="w-3 h-3" />
                  <span>Create Branch</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
