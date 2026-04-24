import React, { useEffect, useState } from 'react';
import { Folder, Plus } from 'lucide-react';

import { Dialog, DialogContent, DialogTitle } from '../../../../shared/view/ui';
import type { ProjectRailItemData } from '../../../project-rail/types/types';

import { KbdCombo } from './Kbd';
import { SHIFT_KEY } from './shortcuts';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  railItems: ProjectRailItemData[];
  activeProjectName: string;
  onNewSessionInProject: (projectName: string) => void;
};

export default function NewSessionPalette({
  open,
  onOpenChange,
  railItems,
  activeProjectName,
  onNewSessionInProject,
}: Props) {
  const [cycleIdx, setCycleIdx] = useState(0);

  useEffect(() => {
    if (!open) return;
    const idx = railItems.findIndex(
      (p) => p.name === activeProjectName || p.displayName === activeProjectName,
    );
    setCycleIdx(Math.max(0, idx));
  }, [open, activeProjectName, railItems]);

  const cycledProject = railItems[cycleIdx] ?? null;
  const projectDisplayName = cycledProject
    ? (cycledProject.displayName || cycledProject.name)
    : activeProjectName;

  const handleCreate = (projectName: string) => {
    onNewSessionInProject(projectName);
    onOpenChange(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Tab' && railItems.length > 1) {
      e.preventDefault();
      setCycleIdx((prev) =>
        e.shiftKey
          ? (prev - 1 + railItems.length) % railItems.length
          : (prev + 1) % railItems.length,
      );
    } else if (e.key === 'Enter') {
      e.preventDefault();
      handleCreate(cycledProject?.name ?? activeProjectName);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm overflow-hidden p-0" onKeyDown={handleKeyDown}>
        <DialogTitle>New session</DialogTitle>
        <div className="p-4">
          <div className="mb-3 flex items-center gap-2.5">
            <Plus className="h-4 w-4 flex-shrink-0" style={{ color: 'var(--project-accent)' }} />
            <span className="text-sm">
              New session in{' '}
              <span className="font-medium" style={{ color: 'var(--project-accent)' }}>
                @{projectDisplayName}
              </span>
            </span>
          </div>

          {railItems.length > 1 && (
            <div className="mb-3 max-h-52 overflow-y-auto rounded-md border border-border/60 divide-y divide-border/40">
              {railItems.map((p, idx) => (
                <button
                  key={p.name}
                  type="button"
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                    idx === cycleIdx
                      ? 'bg-accent text-accent-foreground'
                      : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                  }`}
                  onClick={() => handleCreate(p.name)}
                >
                  <Folder className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                  <span className="truncate">{p.displayName || p.name}</span>
                </button>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between text-[11px] text-muted-foreground/60">
            {railItems.length > 1 ? (
              <span>Tab / {SHIFT_KEY}Tab to switch · ↵ to create</span>
            ) : (
              <span>↵ to create</span>
            )}
            <KbdCombo keys={['Esc']} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
