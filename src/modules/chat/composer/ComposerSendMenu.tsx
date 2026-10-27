import { useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { SendHorizonal } from 'lucide-react';

import { useComposerMenuAnchor } from '@/modules/chat/hooks/useComposerMenuAnchor';
import {
  ComposerMenuItem,
  ComposerMenuSeparator,
  ComposerMenuSurface,
} from '@/modules/chat/composer/ComposerMenuPrimitives';

export type ComposerSendMenuState = 'responding' | 'background';
export type ComposerSendMenuChoice = 'queue' | 'sideQuestion' | 'stop' | 'send';

type ComposerSendMenuProps = {
  /** Whether a turn is still being written, or only background work runs. */
  state: ComposerSendMenuState;
  /** Queue and Send anyway need text or an attachment; Stop never does. */
  hasInput: boolean;
  /** Side question cannot carry attachments, so it needs non-whitespace text on its own; defaults to `hasInput` so existing callers and tests, which never had attachment-only input, keep working. */
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
          <ComposerMenuItem
            disabled={!hasInput}
            isSelected={false}
            role="menuitem"
            label={t('sendMenu.queue.label', { defaultValue: 'Queue' })}
            description={queueDescription}
            onSelect={() => select('queue')}
          />
          <ComposerMenuItem
            disabled={!hasText}
            isSelected={false}
            role="menuitem"
            label={t('sendMenu.sideQuestion.label', { defaultValue: 'Side question' })}
            description={t('sendMenu.sideQuestion.description', { defaultValue: 'Ask on the side now; the session never sees it' })}
            onSelect={() => select('sideQuestion')}
          />
          <ComposerMenuSeparator />
          <ComposerMenuItem
            disabled={state === 'background' && !hasInput}
            isSelected={false}
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
