import { Loader2, Pin } from 'lucide-react';
import type { TFunction } from 'i18next';

import { cn } from '@/shared/utils';
import { useSessionPins } from '@/modules/sidebar/hooks/useSessionPins';

/** Shared by desktop/mobile Projects rows and Conversations controls, including the pinned shortcuts. */
export default function SessionPinButton({ sessionId, sessionName, t }: {
  sessionId: string;
  sessionName: string;
  t: TFunction;
}) {
  const pins = useSessionPins();
  if (!pins) return null;
  const isPinned = pins.pinnedIds.has(sessionId);
  const label = isPinned ? t('pinned.unpin', 'Unpin session') : t('pinned.pin', 'Pin session');
  const isPending = pins.pendingSessionId === sessionId;
  return (
    <button
      type="button"
      className={cn(
        'flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40',
        isPinned ? 'text-primary' : 'text-muted-foreground/50 hover:text-foreground',
      )}
      title={label}
      aria-label={`${label}: ${sessionName}`}
      aria-pressed={isPinned}
      disabled={!pins.ready || pins.pendingSessionId !== null}
      onClick={(event) => {
        event.stopPropagation();
        event.preventDefault();
        void pins.setPinned(sessionId, !isPinned);
      }}
    >
      {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : (
        <Pin className={cn('h-3.5 w-3.5', isPinned && 'fill-primary/15')} />
      )}
    </button>
  );
}
