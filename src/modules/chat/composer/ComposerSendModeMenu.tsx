import { memo, useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { ChevronDownIcon, ClockIcon, Wand2Icon, ZapIcon, type LucideIcon } from 'lucide-react';

import type { ComposerSendMode } from '@/modules/chat/hooks/useChatComposerState';
import { useComposerMenuAnchor } from '@/modules/chat/hooks/useComposerMenuAnchor';
import {
  ComposerMenuHeading,
  ComposerMenuItem,
  ComposerMenuSurface,
} from '@/modules/chat/composer/ComposerMenuPrimitives';

const MODE_ICONS: Record<ComposerSendMode, LucideIcon> = {
  queue: ClockIcon,
  steer: Wand2Icon,
  interrupt: ZapIcon,
};

const MODES: ComposerSendMode[] = ['queue', 'steer', 'interrupt'];

/** Keyboard hint shown next to each mode; swaps once `sendByCtrlEnter` claims plain Ctrl+Enter as the idle send key. */
const shortcutFor = (mode: ComposerSendMode, sendByCtrlEnter?: boolean): string => {
  if (!sendByCtrlEnter) {
    if (mode === 'queue') return 'Enter';
    if (mode === 'steer') return 'Ctrl+Enter';
    return 'Ctrl+Shift+Enter';
  }
  if (mode === 'queue') return 'Ctrl+Enter';
  if (mode === 'steer') return 'Ctrl+Shift+Enter';
  return 'Ctrl+Alt+Enter';
};

type ComposerSendModeMenuProps = {
  sendMode: ComposerSendMode;
  sendByCtrlEnter?: boolean;
  /** Whether the active provider supports `steer` (see providerCanSteer); when false, 'After next tool call' is omitted. */
  canSteer: boolean;
  onSelect: (mode: ComposerSendMode) => void;
};

/**
 * Rendered by chat's ChatComposer as the chevron half of the send split
 * button, shown beside PromptInputSubmit while a turn is in flight and there
 * is a draft to send. Picks whether the draft is sent after the turn ends
 * (queue, the pre-existing behaviour), folded into the running turn at its
 * next tool call (steer), or sent now by interrupting the turn (interrupt).
 */
function ComposerSendModeMenu({ sendMode, sendByCtrlEnter, canSteer, onSelect }: ComposerSendModeMenuProps) {
  const { t } = useTranslation('chat');
  const [isOpen, setIsOpen] = useState(false);
  const close = useCallback(() => setIsOpen(false), []);
  const { triggerRef, menuRef, anchor, updateAnchor } = useComposerMenuAnchor(isOpen, close, 18 * 16);

  const heading = t('input.sendMode.menuLabel', { defaultValue: 'Send mode' });
  // The server rejects every `chat.steer` for a provider that doesn't
  // implement it (see providerCanSteer), so offering it here would just be a
  // menu item that always fails.
  const availableModes = canSteer ? MODES : MODES.filter((mode) => mode !== 'steer');

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={(event) => {
          event.preventDefault();
          updateAnchor();
          setIsOpen((current) => !current);
        }}
        className="flex h-10 w-5 shrink-0 items-center justify-center rounded-r-lg border border-l-0 border-border/60 bg-muted/50 text-muted-foreground transition-colors hover:bg-muted"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label={heading}
        title={heading}
      >
        <ChevronDownIcon className="h-3.5 w-3.5" />
      </button>

      {isOpen && anchor && createPortal(
        <ComposerMenuSurface anchor={anchor} menuRef={menuRef} ariaLabel={heading}>
          <ComposerMenuHeading>{heading}</ComposerMenuHeading>
          {availableModes.map((mode) => {
            const ModeIcon = MODE_ICONS[mode];
            return (
              <ComposerMenuItem
                key={mode}
                icon={<ModeIcon className="h-4 w-4" />}
                label={t(`input.sendMode.${mode}`, { defaultValue: mode })}
                description={shortcutFor(mode, sendByCtrlEnter)}
                isSelected={mode === sendMode}
                onSelect={() => {
                  setIsOpen(false);
                  onSelect(mode);
                }}
              />
            );
          })}
        </ComposerMenuSurface>,
        document.body,
      )}
    </>
  );
}

/** Memoized: the composer re-renders on every keystroke and this menu's props only change on a mode pick. */
export default memo(ComposerSendModeMenu);
