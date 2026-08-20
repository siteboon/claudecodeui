import { useEffect, useRef } from 'react';
import { Check, Edit2, MoreHorizontal, Trash2, X } from 'lucide-react';
import type { TFunction } from 'i18next';

import { ActionMenu } from '../../../../shared/view/ui';
import { cn } from '../../../../lib/utils';
import type { LLMProvider } from '../../../../types/app';
import { useProviderSessionIdCopy } from '../../hooks/useProviderSessionIdCopy';
import { PROVIDER_LABELS } from '../../utils/utils';

type SessionOptionsProps = {
  sessionId: string;
  provider: LLMProvider;
  sessionTitle: string;
  /** False while a session is processing, when deleting it is not offered. */
  canDelete: boolean;
  isEditing: boolean;
  editingName: string;
  onEditingNameChange: (value: string) => void;
  onStartRename: () => void;
  onCancelRename: () => void;
  onSaveRename: () => void;
  onRequestDelete: () => void;
  /**
   * Suppresses the outside-click dismissal, for a caller whose own surface
   * (a bottom sheet) already owns dismissal while it is open.
   */
  suppressOutsideDismiss?: boolean;
  /** Placement, which differs per row. */
  className?: string;
  t: TFunction;
};

/**
 * The trailing controls on a session row: a menu that renames, copies the
 * provider session id and archives or deletes, and the inline rename it swaps
 * itself for. Shared by the Projects list and the Conversations list, so a
 * session offers the same actions wherever it is listed.
 */
export default function SessionOptions({
  sessionId,
  provider,
  sessionTitle,
  canDelete,
  isEditing,
  editingName,
  onEditingNameChange,
  onStartRename,
  onCancelRename,
  onSaveRename,
  onRequestDelete,
  suppressOutsideDismiss = false,
  className,
  t,
}: SessionOptionsProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const providerLabel = PROVIDER_LABELS[provider];
  const copy = useProviderSessionIdCopy(sessionId, providerLabel);
  const CopyStateIcon = copy.icon;

  // While renaming, dismiss only when the click lands outside these controls,
  // which is what Escape and the cancel button do too.
  useEffect(() => {
    if (!isEditing || suppressOutsideDismiss) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const container = containerRef.current;
      if (container && !container.contains(event.target as Node)) {
        onCancelRename();
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [isEditing, onCancelRename, suppressOutsideDismiss]);

  return (
    <div ref={containerRef} className={cn('flex items-center gap-1', className)}>
      {isEditing ? (
        <>
          <input
            type="text"
            aria-label={t('tooltips.editSessionName')}
            value={editingName}
            onChange={(event) => onEditingNameChange(event.target.value)}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === 'Enter') {
                // An IME sends Enter to accept a candidate, which is not a
                // request to save a half-composed name.
                if (!event.nativeEvent.isComposing) {
                  onSaveRename();
                }
              } else if (event.key === 'Escape') {
                onCancelRename();
              }
            }}
            onClick={(event) => event.stopPropagation()}
            className="w-32 rounded border border-border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
            autoFocus
          />
          <button
            type="button"
            className="flex h-6 w-6 items-center justify-center rounded bg-green-50 hover:bg-green-100 dark:bg-green-900/20 dark:hover:bg-green-900/40"
            onClick={(event) => {
              event.stopPropagation();
              onSaveRename();
            }}
            title={t('tooltips.save')}
          >
            <Check className="h-3 w-3 text-green-600 dark:text-green-400" />
          </button>
          <button
            type="button"
            className="flex h-6 w-6 items-center justify-center rounded bg-gray-50 hover:bg-gray-100 dark:bg-gray-900/20 dark:hover:bg-gray-900/40"
            onClick={(event) => {
              event.stopPropagation();
              onCancelRename();
            }}
            title={t('tooltips.cancel')}
          >
            <X className="h-3 w-3 text-gray-600 dark:text-gray-400" />
          </button>
        </>
      ) : (
        <ActionMenu
          label="Session options"
          ariaLabel={`Session options for ${sessionTitle}`}
          icon={MoreHorizontal}
          iconOnly
          portal
          variant="ghost"
          size="icon"
          onOpenChange={copy.setOpen}
          triggerClassName="h-7 w-7 text-muted-foreground opacity-70 hover:bg-muted hover:opacity-100"
          menuClassName="w-[260px] rounded-xl p-1.5 shadow-xl"
          header={(
            <div className="mb-1 border-b border-border px-3 py-2">
              <p className="truncate text-xs font-medium text-foreground" title={sessionTitle}>
                {sessionTitle}
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">{providerLabel} session</p>
            </div>
          )}
          items={[
            {
              key: 'rename',
              label: 'Rename session',
              icon: Edit2,
              onSelect: onStartRename,
            },
            {
              key: 'copy',
              label: copy.label,
              description: copy.hasFailed ? 'Click to try again.' : undefined,
              icon: CopyStateIcon,
              loading: copy.isPending,
              closeOnSelect: false,
              onSelect: copy.copy,
            },
            ...(canDelete ? [{
              key: 'delete',
              label: 'Archive or delete session',
              icon: Trash2,
              isDanger: true,
              showDividerBefore: true,
              onSelect: onRequestDelete,
            }] : []),
          ]}
        />
      )}
    </div>
  );
}

