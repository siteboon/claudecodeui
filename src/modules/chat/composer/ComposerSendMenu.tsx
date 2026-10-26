import { useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { SendHorizonal } from 'lucide-react';

import { cn } from '@/shared/utils';
import { useComposerMenuAnchor } from '@/modules/chat/hooks/useComposerMenuAnchor';
import {
  ComposerMenuSeparator,
  ComposerMenuSurface,
} from '@/modules/chat/composer/ComposerMenuPrimitives';

export type ComposerSendMenuState = 'responding' | 'background';
export type ComposerSendMenuChoice = 'queue' | 'btw' | 'stop' | 'send';

type ComposerSendMenuProps = {
  /** Whether a turn is still being written, or only background work runs. */
  state: ComposerSendMenuState;
  /** Queue and Send anyway need text or an attachment; Stop never does. */
  hasInput: boolean;
  /** BTW cannot carry attachments, so it needs non-whitespace text on its own; defaults to `hasInput` so existing callers and tests, which never had attachment-only input, keep working. */
  hasText?: boolean;
  onSelect: (choice: ComposerSendMenuChoice) => void;
};

/**
 * Rendered by chat's ChatComposer in place of the send button while a turn is
 * written or only background work runs. The destructive choice (Stop, or
 * Send anyway over background work) is last and red, as in the
 * background-send dialog, so a tap on the first row can never stop or
 * override anything.
 */
export default function ComposerSendMenu({ state, hasInput, hasText = hasInput, onSelect }: ComposerSendMenuProps) {
  const { t } = useTranslation('chat');
  const [isOpen, setIsOpen] = useState(false);
  const close = useCallback(() => setIsOpen(false), []);
  const { triggerRef, menuRef, anchor, updateAnchor } = useComposerMenuAnchor(isOpen, close);

  const triggerLabel = t('sendMenu.trigger', { defaultValue: 'Send options' });
  const select = (choice: ComposerSendMenuChoice) => {
    setIsOpen(false);
    onSelect(choice);
  };

  const lastLabel = state === 'responding'
    ? t('sendMenu.stop.label', { defaultValue: 'Stop' })
    : t('sendMenu.sendAnyway.label', { defaultValue: 'Send anyway' });
  const lastDescription = state === 'responding'
    ? t('sendMenu.stop.description', { defaultValue: 'End the response being written' })
    : t('sendMenu.sendAnyway.description', { defaultValue: 'Send now; this stops the background work' });
  const lastChoice: ComposerSendMenuChoice = state === 'responding' ? 'stop' : 'send';
  const queueDescription = state === 'responding'
    ? t('sendMenu.queue.descriptionResponding', { defaultValue: 'Send when this turn ends' })
    : t('sendMenu.queue.descriptionBackground', { defaultValue: 'Send when the background work ends' });

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          updateAnchor();
          setIsOpen((current) => !current);
        }}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label={triggerLabel}
        title={triggerLabel}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-foreground transition-colors hover:bg-muted"
      >
        <SendHorizonal className="h-4 w-4" />
      </button>

      {isOpen && anchor && createPortal(
        <ComposerMenuSurface anchor={anchor} menuRef={menuRef} ariaLabel={triggerLabel}>
          <ComposerMenuItemDisabled
            disabled={!hasInput}
            role="menuitem"
            label={t('sendMenu.queue.label', { defaultValue: 'Queue' })}
            description={queueDescription}
            onSelect={() => select('queue')}
          />
          <ComposerMenuItemDisabled
            disabled={!hasText}
            role="menuitem"
            label={t('sendMenu.btw.label', { defaultValue: 'BTW' })}
            description={t('sendMenu.btw.description', { defaultValue: 'Ask on the side now; the session never sees it' })}
            onSelect={() => select('btw')}
          />
          <ComposerMenuSeparator />
          <ComposerMenuItemDisabled
            disabled={state === 'background' && !hasInput}
            role="menuitem"
            label={lastLabel}
            description={lastDescription}
            onSelect={() => select(lastChoice)}
            destructive
          />
        </ComposerMenuSurface>,
        document.body,
      )}
    </>
  );
}

/**
 * A plain menu row cannot be disabled (`ComposerMenuItem` has no such prop,
 * and the model/permission menus never need one), so this wraps it with a
 * real `disabled`/`aria-disabled` button and the destructive styling the
 * send menu's Stop and Send-anyway rows need.
 */
function ComposerMenuItemDisabled({
  disabled,
  role,
  label,
  description,
  onSelect,
  className,
  destructive,
}: {
  disabled?: boolean;
  role: 'menuitem';
  label: string;
  description: string;
  onSelect: () => void;
  className?: string;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      role={role}
      disabled={disabled}
      aria-disabled={disabled}
      onClick={disabled ? undefined : onSelect}
      className={cn(
        'flex w-full items-start gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors',
        disabled
          ? 'cursor-not-allowed opacity-50'
          : 'hover:bg-accent focus-visible:bg-accent focus-visible:outline-none',
        destructive ? 'text-destructive' : 'text-foreground/90',
        className,
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate leading-5">{label}</span>
        <span className="mt-0.5 block text-xs leading-4 text-muted-foreground">{description}</span>
      </span>
    </button>
  );
}
