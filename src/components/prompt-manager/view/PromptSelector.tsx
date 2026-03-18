import React from 'react';
import { Sparkles, type LucideIcon } from 'lucide-react';
import * as Icons from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ActiveRoleWithPriority } from '../types/types';

interface PromptSelectorProps {
  onOpenLibrary: () => void;
  activeRoles: ActiveRoleWithPriority[];
  onOpenRoleManagement: () => void;
}

export default function PromptSelector({
  onOpenLibrary,
  activeRoles,
  onOpenRoleManagement
}: PromptSelectorProps) {
  const { t } = useTranslation('chat');

  return (
    <div className="flex items-center gap-1">
      {/* Active Roles Counter */}
      {activeRoles.length > 0 && (
        <button
          type="button"
          onClick={onOpenRoleManagement}
          className="flex items-center gap-1.5 rounded-lg border border-primary/20 bg-primary/10 px-2 py-1 text-xs text-primary transition-colors hover:bg-primary/20"
          title={t('promptLibrary.selector.manageRoles')}
        >
          <span className="font-medium">
            {activeRoles.length} {activeRoles.length === 1 ? t('promptLibrary.selector.role') : t('promptLibrary.selector.roles')}
          </span>
        </button>
      )}

      {/* Open Library Button */}
      <button
        type="button"
        onClick={onOpenLibrary}
        className="rounded-lg p-2 transition-colors hover:bg-accent/60"
        title={t('promptLibrary.selector.openLibrary')}
      >
        <Sparkles className="h-5 w-5 text-muted-foreground" />
      </button>
    </div>
  );
}
