import { memo, useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  Bot,
  ClipboardList,
  Hand,
  RotateCw,
  ShieldQuestion,
  Smile,
  type LucideIcon,
} from 'lucide-react';

import type { PermissionMode } from '@/shared/types';
import { useComposerMenuAnchor } from '@/modules/chat/hooks/useComposerMenuAnchor';
import { usePermissionNameFit } from '@/modules/chat/hooks/usePermissionNameFit';
import {
  ComposerMenuHeading,
  ComposerMenuItem,
  ComposerMenuSeparator,
  ComposerMenuSurface,
} from '@/modules/chat/composer/ComposerMenuPrimitives';

type ModeAppearance = {
  icon: LucideIcon;
  /** English name, the fallback for the `codex.modes.<mode>` translation. */
  label: string;
  trigger: string;
  item: string;
};

/**
 * Presentation only. Which modes exist for a provider comes from the backend
 * capability matrix, so an unknown mode still renders through UNKNOWN_MODE.
 */
const MODE_APPEARANCE: Record<PermissionMode, ModeAppearance> = {
  default: {
    icon: Hand,
    label: 'Default Mode',
    trigger: 'border-border/60 bg-muted/50 text-muted-foreground hover:bg-muted',
    item: 'text-foreground',
  },
  auto: {
    icon: Bot,
    label: 'Auto Mode',
    trigger:
      'border-blue-300/60 bg-blue-50 text-blue-700 hover:bg-blue-100 dark:border-blue-600/40 dark:bg-blue-900/15 dark:text-blue-300 dark:hover:bg-blue-900/25',
    item: 'text-blue-700 dark:text-blue-300',
  },
  acceptEdits: {
    icon: Smile,
    label: 'Accept Edits',
    trigger:
      'border-green-300/60 bg-green-50 text-green-700 hover:bg-green-100 dark:border-green-600/40 dark:bg-green-900/15 dark:text-green-300 dark:hover:bg-green-900/25',
    item: 'text-green-700 dark:text-green-300',
  },
  bypassPermissions: {
    icon: AlertTriangle,
    label: 'Bypass Permissions',
    trigger:
      'border-orange-300/60 bg-orange-50 text-orange-700 hover:bg-orange-100 dark:border-orange-600/40 dark:bg-orange-900/15 dark:text-orange-300 dark:hover:bg-orange-900/25',
    item: 'text-orange-600 dark:text-orange-400',
  },
  plan: {
    icon: ClipboardList,
    label: 'Plan Mode',
    trigger: 'border-primary/20 bg-primary/5 text-primary hover:bg-primary/10',
    item: 'text-primary',
  },
};

const UNKNOWN_MODE: ModeAppearance = {
  icon: ShieldQuestion,
  label: '',
  trigger: 'border-border/60 bg-muted/50 text-muted-foreground hover:bg-muted',
  item: 'text-foreground',
};

const getAppearance = (mode: PermissionMode | string): ModeAppearance =>
  MODE_APPEARANCE[mode as PermissionMode] ?? UNKNOWN_MODE;

type ComposerPermissionMenuProps = {
  permissionMode: PermissionMode;
  /** Modes the active provider supports, in the order the backend reports them. */
  permissionModes: PermissionMode[];
  onSelectPermissionMode: (mode: PermissionMode) => void;
  providerLabel: string;
  /** This session's "continue after the usage limit" switch; both absent where it does not apply. */
  autoContinueEnabled?: boolean;
  onAutoContinueChange?: (enabled: boolean) => void;
};

/**
 * Rendered by chat's ChatComposer as the popover for choosing the permission
 * mode the active provider runs the next turn under.
 */
function ComposerPermissionMenu({
  permissionMode,
  permissionModes,
  onSelectPermissionMode,
  providerLabel,
  autoContinueEnabled = false,
  onAutoContinueChange,
}: ComposerPermissionMenuProps) {
  const { t } = useTranslation('chat');
  const [isOpen, setIsOpen] = useState(false);
  const close = useCallback(() => setIsOpen(false), []);
  const { triggerRef, menuRef, anchor, updateAnchor } = useComposerMenuAnchor(isOpen, close, 22 * 16);
  const modeLabel = (mode: PermissionMode) =>
    t(`codex.modes.${mode}`, { defaultValue: getAppearance(mode).label || mode });
  const activeModeLabel = modeLabel(permissionMode);
  // The name is shown only where the composer has room for it, so it never
  // pushes the model menu and the send button onto a second row. Plan mode,
  // the one that changes nothing, keeps its name wherever it fits inside the
  // composer, even when that gives the controls a row of their own.
  const isNameShown = usePermissionNameFit(
    triggerRef,
    permissionModes.length > 0 ? activeModeLabel : null,
    permissionMode === 'plan',
  );

  if (permissionModes.length === 0) {
    return null;
  }

  const activeAppearance = getAppearance(permissionMode);
  const ActiveIcon = activeAppearance.icon;
  const heading = t('composer.permissionHeading', {
    provider: providerLabel,
    defaultValue: 'How should {{provider}} actions be approved?',
  });
  const isAutoContinueShown = Boolean(onAutoContinueChange) && autoContinueEnabled;
  const autoContinueNote = isAutoContinueShown ? ` — ${t('autoContinue.on')}` : '';

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          updateAnchor();
          setIsOpen((current) => !current);
        }}
        className={`relative flex h-8 min-w-8 max-w-40 shrink-0 items-center justify-center gap-1.5 rounded-lg border text-xs font-medium transition-colors sm:max-w-48 ${isNameShown ? 'px-2' : 'w-8'} ${activeAppearance.trigger}`}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        // The mode name leads the accessible name, so what a screen reader
        // announces starts with what the button shows.
        aria-label={t('composer.permissionTriggerLabel', {
          mode: activeModeLabel,
          heading,
          defaultValue: '{{mode}}: {{heading}}',
        }) + autoContinueNote}
        title={t('input.clickToChangeMode') + autoContinueNote}
      >
        <ActiveIcon className="h-4 w-4 shrink-0" />
        {/* Named, not just drawn: the mode decides what the next message may change. */}
        {isNameShown && <span className="truncate">{activeModeLabel}</span>}
        {/* Overlaid, so the switch being on never widens the controls row. */}
        {isAutoContinueShown && (
          <span className="absolute -right-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <RotateCw className="h-2.5 w-2.5" aria-hidden />
          </span>
        )}
      </button>

      {isOpen && anchor && createPortal(
        <ComposerMenuSurface anchor={anchor} menuRef={menuRef} ariaLabel={heading}>
          <ComposerMenuHeading>{heading}</ComposerMenuHeading>
          {permissionModes.map((mode) => {
            const appearance = getAppearance(mode);
            const ModeIcon = appearance.icon;
            return (
              <ComposerMenuItem
                key={mode}
                icon={<ModeIcon className="h-4 w-4" />}
                label={modeLabel(mode)}
                description={t(`codex.descriptions.${mode}`, { defaultValue: '' }) || undefined}
                isSelected={mode === permissionMode}
                onSelect={() => {
                  onSelectPermissionMode(mode);
                  setIsOpen(false);
                }}
                className={appearance.item}
              />
            );
          })}
          <ComposerMenuHeading>
            {t('composer.permissionCycleHint', { defaultValue: 'Press Tab in the message box to switch modes' })}
          </ComposerMenuHeading>
          {onAutoContinueChange && (
            // Lives here rather than as its own composer button, which pushed
            // the controls onto a second row on phones. Set apart below the
            // modes, so it never reads as a second selected mode.
            <>
              <ComposerMenuSeparator />
              <ComposerMenuItem
                role="menuitemcheckbox"
                icon={<RotateCw className="h-4 w-4" />}
                label={t('autoContinue.toggle')}
                description={t('autoContinue.description')}
                isSelected={autoContinueEnabled}
                onSelect={() => onAutoContinueChange(!autoContinueEnabled)}
              />
            </>
          )}
        </ComposerMenuSurface>,
        document.body,
      )}
    </>
  );
}

/** Memoized: the composer re-renders on every keystroke and none of this menu's props change while typing. */
export default memo(ComposerPermissionMenu);
