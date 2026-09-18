import { useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Clock } from 'lucide-react';

import { cn } from '@/shared/utils';
import { useComposerMenuAnchor } from '@/modules/chat/hooks/useComposerMenuAnchor';
import {
  ComposerMenuHeading,
  ComposerMenuItem,
  ComposerMenuSeparator,
  ComposerMenuSurface,
} from '@/modules/chat/composer/ComposerMenuPrimitives';

type ScheduleMessagePopoverProps = {
  disabled: boolean;
  onSchedule: (scheduledFor: Date) => void;
};

/** Offsets people actually mean when they say "later". */
const QUICK_OFFSETS_MINUTES = [15, 60, 8 * 60, 24 * 60];

/**
 * Turns the picker's `datetime-local` value into an absolute instant.
 *
 * That input carries no zone, and `new Date(value)` reads it in the browser's
 * — which is what the user meant, since they picked it off their own clock.
 * Converting here means the server stores one unambiguous instant, so the
 * schedule does not move if they are on another device when it fires.
 */
function readLocalDateTime(value: string): Date | null {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toLocalInputValue(date: Date): string {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

/**
 * Rendered by chat's ChatComposer beside the send button so the message in the
 * box can be sent later instead of now.
 */
export function ScheduleMessagePopover({ disabled, onSchedule }: ScheduleMessagePopoverProps) {
  const { t } = useTranslation('chat');
  const [isOpen, setIsOpen] = useState(false);
  const close = useCallback(() => setIsOpen(false), []);
  // Portalled and anchored like the model and permission menus: the composer
  // sits inside the scrolling transcript's stacking context, so a popover
  // positioned inside it is clipped by the message pane.
  const { triggerRef, menuRef, anchor, updateAnchor } = useComposerMenuAnchor(isOpen, close);
  // Seeded an hour out, because a picker that opens on "now" is never what
  // scheduling means.
  const [customValue, setCustomValue] = useState(() => toLocalInputValue(new Date(Date.now() + 3_600_000)));

  const commit = (scheduledFor: Date) => {
    onSchedule(scheduledFor);
    setIsOpen(false);
  };

  const ariaLabel = t('schedule.trigger');

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => {
          updateAnchor();
          setIsOpen((current) => !current);
        }}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label={ariaLabel}
        title={ariaLabel}
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-muted/40 text-muted-foreground transition-colors',
          disabled ? 'cursor-not-allowed opacity-40' : 'hover:bg-muted hover:text-foreground',
          isOpen && 'text-foreground',
        )}
      >
        <Clock className="h-4 w-4" />
      </button>

      {isOpen && anchor && createPortal(
        <ComposerMenuSurface anchor={anchor} menuRef={menuRef} ariaLabel={ariaLabel}>
          <ComposerMenuHeading>{t('schedule.heading')}</ComposerMenuHeading>
          {QUICK_OFFSETS_MINUTES.map((minutes) => (
            <ComposerMenuItem
              key={minutes}
              label={t(`schedule.in.${minutes}`)}
              description={new Date(Date.now() + minutes * 60_000).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
              isSelected={false}
              onSelect={() => commit(new Date(Date.now() + minutes * 60_000))}
            />
          ))}

          <ComposerMenuSeparator />
          <div className="px-2.5 pb-1.5">
            <label className="block text-[11px] font-medium text-muted-foreground" htmlFor="schedule-at">
              {t('schedule.customLabel')}
            </label>
            <input
              id="schedule-at"
              type="datetime-local"
              value={customValue}
              onChange={(event) => setCustomValue(event.target.value)}
              className="mt-1 w-full rounded-md border border-border/60 bg-background px-2 py-1 text-xs text-foreground"
            />
            <button
              type="button"
              onClick={() => {
                const parsed = readLocalDateTime(customValue);
                if (parsed) commit(parsed);
              }}
              className="mt-2 w-full rounded-md bg-primary px-2 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              {t('schedule.confirm')}
            </button>
          </div>
        </ComposerMenuSurface>,
        document.body,
      )}
    </>
  );
}
