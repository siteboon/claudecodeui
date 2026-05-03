import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GitBranch, Plus, Trash2 } from 'lucide-react';
import type { BranchSelectorProps } from './types';

export default function BranchSelector({
  branches,
  activeBranchId,
  onSwitchBranch,
  onDeleteBranch,
}: BranchSelectorProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const activeBranch = branches.find((b) => b.id === activeBranchId);
  const hasMultiple = branches.length > 1;

  if (!hasMultiple) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <GitBranch className="h-3.5 w-3.5" />
        <span>{activeBranch?.name ?? 'Main'}</span>
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        aria-label={t('branching.selector')}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
      >
        <GitBranch className="h-3.5 w-3.5" />
        <span>{activeBranch?.name ?? 'Main'}</span>
        <span
          data-testid="branch-count"
          className="rounded-full bg-secondary px-1.5 text-[10px] font-medium"
        >
          {branches.length}
        </span>
      </button>

      {open && (
        <div className="absolute bottom-full left-0 z-50 mb-1 w-64 rounded-lg border border-border bg-background shadow-lg">
          <div className="max-h-60 overflow-y-auto p-1">
            {branches.map((branch) => {
              const isActive = branch.id === activeBranchId;
              const isMain = branch.parentBranchId === null;
              return (
                <div
                  key={branch.id}
                  data-active={isActive}
                  className={`flex items-center justify-between rounded px-2 py-1.5 text-sm transition-colors cursor-pointer hover:bg-secondary/50 ${isActive ? 'bg-secondary' : ''}`}
                  onClick={() => {
                    onSwitchBranch(branch.id);
                    setOpen(false);
                  }}
                >
                  <div className="flex-1 min-w-0">
                    <span className="block truncate text-foreground">{branch.name}</span>
                    {!isMain && (
                      <span className="text-[10px] text-muted-foreground">
                        from message {branch.branchPointMessageIndex}
                      </span>
                    )}
                  </div>
                  {!isMain && (
                    <button
                      type="button"
                      aria-label={t('branching.delete')}
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteBranch(branch.id);
                      }}
                      className="shrink-0 rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          <div className="border-t border-border p-1">
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>{t('branching.createNew')}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
