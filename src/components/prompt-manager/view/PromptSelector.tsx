import React from 'react';
import { Sparkles, X, type LucideIcon } from 'lucide-react';
import * as Icons from 'lucide-react';
import { ActiveRole } from '../types/types';

interface PromptSelectorProps {
  onOpenLibrary: () => void;
  activeRole: ActiveRole | null;
  onClearRole: () => void;
}

export default function PromptSelector({
  onOpenLibrary,
  activeRole,
  onClearRole
}: PromptSelectorProps) {
  let RoleIcon: LucideIcon | null = null;

  if (activeRole?.icon) {
    const iconKey = activeRole.icon as keyof typeof Icons;
    const IconComponent = Icons[iconKey];
    if (IconComponent && typeof IconComponent === 'function') {
      RoleIcon = IconComponent as LucideIcon;
    }
  }

  return (
    <div className="flex items-center gap-1">
      {/* Active Role Indicator */}
      {activeRole && (
        <div className="flex items-center gap-1.5 rounded-lg border border-primary/20 bg-primary/10 px-2 py-1 text-xs text-primary">
          {RoleIcon && <RoleIcon className="h-3.5 w-3.5" />}
          <span className="font-medium">{activeRole.name}</span>
          <button
            type="button"
            onClick={onClearRole}
            className="rounded p-0.5 transition-colors hover:bg-primary/20"
            title="Clear role"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      {/* Open Library Button */}
      <button
        type="button"
        onClick={onOpenLibrary}
        className="rounded-lg p-2 transition-colors hover:bg-accent/60"
        title="Open Prompt Library"
      >
        <Sparkles className="h-5 w-5 text-muted-foreground" />
      </button>
    </div>
  );
}
