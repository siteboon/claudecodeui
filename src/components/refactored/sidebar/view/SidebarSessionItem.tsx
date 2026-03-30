import { Check, Edit2, Trash2, X } from 'lucide-react';

import SessionProviderLogo from '@/components/llm-logo-provider/SessionProviderLogo';
import type { WorkspaceSession } from '@/components/refactored/sidebar/types';
import {
  formatRelativeTime,
  getSessionDisplayName,
  isRecentActivity,
} from '@/components/refactored/sidebar/utils/workspaceTransforms';
import { cn } from '@/lib/utils';
import { Button } from '@/shared/view/ui';

type SidebarSessionItemProps = {
  session: WorkspaceSession;
  isSelected: boolean;
  isEditing: boolean;
  editingSessionName: string;
  isSavingSessionName: boolean;
  onEditingSessionNameChange: (name: string) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onSelect: () => void;
  onDelete: () => void;
};

export function SidebarSessionItem({
  session,
  isSelected,
  isEditing,
  editingSessionName,
  isSavingSessionName,
  onEditingSessionNameChange,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onSelect,
  onDelete,
}: SidebarSessionItemProps) {
  const sessionName = getSessionDisplayName(session);
  const sessionActivityLabel = formatRelativeTime(session.lastActivity);
  const showRecentBadge = isRecentActivity(session.lastActivity);

  const handleSaveEdit = () => {
    if (!isSavingSessionName) {
      onSaveEdit();
    }
  };

  return (
    <div className="group relative">
      <div className="md:hidden">
        <div
          className={cn(
            'mx-3 my-0.5 rounded-md border bg-card p-2 transition-all duration-150 active:scale-[0.98]',
            isSelected ? 'border-primary/20 bg-primary/5' : 'border-border/30',
          )}
          onClick={onSelect}
        >
          <div className="flex items-center gap-2">
            <div
              className={cn(
                'flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md',
                isSelected ? 'bg-primary/10' : 'bg-muted/50',
              )}
            >
              <SessionProviderLogo provider={session.provider} className="h-3 w-3" />
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
                  {sessionName}
                </div>
                <div className="flex flex-shrink-0 items-center gap-1">
                  {showRecentBadge && <span className="h-2 w-2 rounded-full bg-green-500" />}
                  <span className="text-xs text-muted-foreground">{sessionActivityLabel}</span>
                </div>
              </div>
            </div>

            <button
              className="ml-1 flex h-7 w-7 items-center justify-center rounded-md bg-red-50 opacity-70 transition-transform active:scale-95 dark:bg-red-900/20"
              onClick={(event) => {
                event.stopPropagation();
                onDelete();
              }}
            >
              <Trash2 className="h-2.5 w-2.5 text-red-600 dark:text-red-400" />
            </button>
          </div>
        </div>
      </div>

      <div className="hidden md:block">
        <Button
          variant="ghost"
          className={cn(
            'h-auto w-full justify-start p-2 text-left font-normal transition-colors duration-200 hover:bg-accent/50',
            isSelected && 'bg-accent text-accent-foreground',
          )}
          onClick={() => {
            if (!isEditing) {
              onSelect();
            }
          }}
        >
          <div className="flex w-full min-w-0 items-start gap-2">
            <SessionProviderLogo provider={session.provider} className="mt-0.5 h-3 w-3 flex-shrink-0" />
            <div className="min-w-0 flex-1">
              {isEditing ? (
                <input
                  type="text"
                  value={editingSessionName}
                  onChange={(event) => onEditingSessionNameChange(event.target.value)}
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.key === 'Enter') {
                      handleSaveEdit();
                    }
                    if (event.key === 'Escape') {
                      onCancelEdit();
                    }
                  }}
                  className="w-full rounded border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  autoFocus
                />
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
                      {sessionName}
                    </div>
                    <div className="flex flex-shrink-0 items-center gap-1 transition-opacity group-hover:opacity-0">
                      {showRecentBadge && <span className="h-2 w-2 rounded-full bg-green-500" />}
                      <span className="text-xs text-muted-foreground">{sessionActivityLabel}</span>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </Button>

        {isEditing ? (
          <div className="absolute right-2 top-1/2 flex -translate-y-1/2 transform items-center gap-1">
            <button
              className="flex h-8 w-8 items-center justify-center rounded bg-green-50 hover:bg-green-100 dark:bg-green-900/20 dark:hover:bg-green-900/40"
              onClick={(event) => {
                event.stopPropagation();
                handleSaveEdit();
              }}
              title="Save"
            >
              <Check className="h-3 w-3 text-green-600 dark:text-green-400" />
            </button>
            <button
              className="flex h-8 w-8 items-center justify-center rounded bg-gray-50 hover:bg-gray-100 dark:bg-gray-900/20 dark:hover:bg-gray-900/40"
              onClick={(event) => {
                event.stopPropagation();
                onCancelEdit();
              }}
              title="Cancel"
            >
              <X className="h-3 w-3 text-gray-600 dark:text-gray-400" />
            </button>
          </div>
        ) : (
          <div className="absolute right-2 top-1/2 flex -translate-y-1/2 transform items-center gap-1 opacity-0 transition-all duration-200 group-hover:opacity-100">
            <button
              className="flex h-8 w-8 items-center justify-center rounded bg-gray-50 hover:bg-gray-100 dark:bg-gray-900/20 dark:hover:bg-gray-900/40"
              onClick={(event) => {
                event.stopPropagation();
                onStartEdit();
              }}
              title="Rename session"
            >
              <Edit2 className="h-3 w-3 text-gray-600 dark:text-gray-400" />
            </button>
            <button
              className="flex h-8 w-8 items-center justify-center rounded bg-red-50 hover:bg-red-100 dark:bg-red-900/20 dark:hover:bg-red-900/40"
              onClick={(event) => {
                event.stopPropagation();
                onDelete();
              }}
              title="Delete session"
            >
              <Trash2 className="h-3 w-3 text-red-600 dark:text-red-400" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
