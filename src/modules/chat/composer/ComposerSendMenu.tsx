import { useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { ChevronUpIcon } from 'lucide-react';

import { useComposerMenuAnchor } from '@/modules/chat/hooks/useComposerMenuAnchor';
import { Button } from '@/shared/ui/Button';
import {
  ComposerMenuItem,
  ComposerMenuSeparator,
  ComposerMenuSurface,
} from '@/modules/chat/composer/ComposerMenuPrimitives';

const isApplePlatform = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

// Same symbol the OS shows on its own menus; no textual word to translate, so
// this stays out of i18n (unlike the row's label and description).
const SIDE_QUESTION_SHORTCUT = isApplePlatform ? '⌥↵' : 'Alt+↵';

export type ComposerSendMenuState = 'responding' | 'background';
export type ComposerSendMenuChoice = 'queue' | 'sideQuestion' | 'stop' | 'send';

type ComposerSendMenuProps = {
  /** Whether a turn is still being written, or only background work runs. */
  state: ComposerSendMenuState;
  /** Queue and Send anyway need text or an attachment; Stop never does. */
  hasInput: boolean;
  /** Side question cannot carry attachments, so it needs non-whitespace text on its own; defaults to `hasInput` so existing callers and tests, which never had attachment-only input, keep working. */
  hasText?: boolean;
  /** False until the capability matrix has loaded, or for a provider it does not list; the side-question row is left out rather than offered and then refused. */
  supportsSideQuestions?: boolean;
  /** Mirrors the composer's "send with Ctrl+Enter" setting, so Queue's hint names the key that actually sends; defaults to false, Enter-to-send, like the composer's own default. */
  sendByCtrlEnter?: boolean;
  onSelect: (choice: ComposerSendMenuChoice) => void;
};

/**
 * One `<kbd>` styling, shared by every row's hint instead of repeated three
 * times: hidden unless the pointer is fine and can hover, same as the
 * side-question hint had before the other rows got one.
 */
function ShortcutHint({ children }: { children: string }) {
  return (
    <kbd className="hidden rounded border border-border/60 px-1 text-[10px] text-muted-foreground/70 [@media(hover:hover)_and_(pointer:fine)]:inline-block">
      {children}
    </kbd>
  );
}

/**
 * Rendered by chat's ChatComposer in place of the send button while a turn is
 * written or only background work runs. The destructive choice (Stop, or
 * Send anyway over background work) is last and red, as in the
 * background-send dialog, so a tap on the first row can never stop or
 * override anything.
 */
export default function ComposerSendMenu({ state, hasInput, hasText = hasInput, supportsSideQuestions = false, sendByCtrlEnter = false, onSelect }: ComposerSendMenuProps) {
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
  // Enter only queues while a turn is written; during background work it
  // opens the "send anyway?" confirm dialog instead, so Queue gets no hint
  // there, matching that row's own description above.
  const queueShortcut = state === 'responding'
    ? (sendByCtrlEnter ? (isApplePlatform ? '⌘↵' : 'Ctrl+↵') : '↵')
    : null;
  // Esc stops a running turn; background work has no key for Send anyway,
  // so the last row's hint follows the same gate as Queue's.
  const lastShortcut = state === 'responding' ? 'esc' : null;

  return (
    <>
      <Button
        ref={triggerRef}
        type="button"
        variant="default"
        size="icon"
        onClick={() => {
          updateAnchor();
          setIsOpen((current) => !current);
        }}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label={triggerLabel}
        title={triggerLabel}
        className="h-10 w-10 shrink-0 rounded-lg"
      >
        <ChevronUpIcon className="h-5 w-5" />
      </Button>

      {isOpen && anchor && createPortal(
        <ComposerMenuSurface anchor={anchor} menuRef={menuRef} ariaLabel={triggerLabel}>
          <ComposerMenuItem
            disabled={!hasInput}
            isSelected={false}
            role="menuitem"
            label={t('sendMenu.queue.label', { defaultValue: 'Queue' })}
            description={queueDescription}
            trailing={queueShortcut ? <ShortcutHint>{queueShortcut}</ShortcutHint> : undefined}
            onSelect={() => select('queue')}
          />
          {supportsSideQuestions && (
            <ComposerMenuItem
              disabled={!hasText}
              isSelected={false}
              role="menuitem"
              label={t('sendMenu.sideQuestion.label', { defaultValue: 'Side question' })}
              description={t('sendMenu.sideQuestion.description', { defaultValue: 'Ask on the side now; the session never sees it' })}
              trailing={<ShortcutHint>{SIDE_QUESTION_SHORTCUT}</ShortcutHint>}
              onSelect={() => select('sideQuestion')}
            />
          )}
          <ComposerMenuSeparator />
          <ComposerMenuItem
            disabled={state === 'background' && !hasInput}
            isSelected={false}
            role="menuitem"
            label={lastLabel}
            description={lastDescription}
            trailing={lastShortcut ? <ShortcutHint>{lastShortcut}</ShortcutHint> : undefined}
            onSelect={() => select(lastChoice)}
            destructive
          />
        </ComposerMenuSurface>,
        document.body,
      )}
    </>
  );
}
