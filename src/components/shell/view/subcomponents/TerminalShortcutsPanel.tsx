import { type MutableRefObject, type MouseEvent, type TouchEvent, useState, useCallback, useEffect, useRef } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Keyboard,
  ArrowDownToLine,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Terminal } from '@xterm/xterm';
import { sendSocketMessage } from '../../utils/socket';

const SHORTCUTS = [
  { id: 'escape', labelKey: 'escape', sequence: '\x1b', hint: 'Esc' },
  { id: 'tab', labelKey: 'tab', sequence: '\t', hint: 'Tab' },
  { id: 'shift-tab', labelKey: 'shiftTab', sequence: '\x1b[Z', hint: '\u21e7Tab' },
  { id: 'arrow-up', labelKey: 'arrowUp', sequence: '\x1b[A', hint: '\u2191' },
  { id: 'arrow-down', labelKey: 'arrowDown', sequence: '\x1b[B', hint: '\u2193' },
] as const;

type TerminalShortcutsPanelProps = {
  wsRef: MutableRefObject<WebSocket | null>;
  terminalRef: MutableRefObject<Terminal | null>;
  isConnected: boolean;
};

const preventFocusSteal = (e: MouseEvent) => e.preventDefault();

export default function TerminalShortcutsPanel({
  wsRef,
  terminalRef,
  isConnected,
}: TerminalShortcutsPanelProps) {
  const { t } = useTranslation('settings');
  const [isOpen, setIsOpen] = useState(false);
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current) {
        clearTimeout(closeTimeoutRef.current);
      }
    };
  }, []);

  const handleToggle = useCallback(() => {
    setIsOpen((prev) => !prev);
  }, []);

  const handleShortcutAction = useCallback((action: () => void) => {
    action();
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    closeTimeoutRef.current = setTimeout(() => setIsOpen(false), 50);
  }, []);

  const handleShortcutTouch = useCallback(
    (e: TouchEvent, action: () => void) => {
      e.preventDefault();
      handleShortcutAction(action);
    },
    [handleShortcutAction],
  );

  const handleToggleTouch = useCallback(
    (e: TouchEvent) => {
      e.preventDefault();
      handleToggle();
    },
    [handleToggle],
  );

  const sendInput = useCallback(
    (data: string) => {
      sendSocketMessage(wsRef.current, { type: 'input', data });
    },
    [wsRef],
  );

  const scrollToBottom = useCallback(() => {
    terminalRef.current?.scrollToBottom();
  }, [terminalRef]);

  return (
    <>
      {/* Pull Tab */}
      <button
        type="button"
        onMouseDown={preventFocusSteal}
        onTouchEnd={handleToggleTouch}
        onClick={handleToggle}
        className={`fixed ${
          isOpen ? 'right-64' : 'right-0'
        } z-50 transition-all duration-150 ease-out bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-l-md p-2 hover:bg-gray-100 dark:hover:bg-gray-700 shadow-lg cursor-pointer`}
        style={{ top: '50%', transform: 'translateY(-50%)' }}
        aria-label={
          isOpen
            ? t('terminalShortcuts.handle.closePanel')
            : t('terminalShortcuts.handle.openPanel')
        }
      >
        {isOpen ? (
          <ChevronRight className="h-5 w-5 text-gray-600 dark:text-gray-400" />
        ) : (
          <ChevronLeft className="h-5 w-5 text-gray-600 dark:text-gray-400" />
        )}
      </button>

      {/* Panel */}
      <div
        className={`fixed top-0 right-0 h-full w-64 bg-background border-l border-border shadow-xl transform transition-transform duration-150 ease-out z-40 ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="h-full flex flex-col">
          {/* Header */}
          <div className="p-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              <Keyboard className="h-5 w-5 text-gray-600 dark:text-gray-400" />
              {t('terminalShortcuts.title')}
            </h3>
          </div>

          {/* Content — conditionally rendered so buttons remount with clean CSS states */}
          {isOpen && (
            <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 space-y-6 bg-background">
              {/* Shortcut Keys */}
              <div className="space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">
                  {t('terminalShortcuts.sectionKeys')}
                </h4>
                {SHORTCUTS.map((shortcut) => (
                  <button
                    type="button"
                    key={shortcut.id}
                    onMouseDown={preventFocusSteal}
                    onTouchEnd={(e) =>
                      handleShortcutTouch(e, () => sendInput(shortcut.sequence))
                    }
                    onClick={() =>
                      handleShortcutAction(() => sendInput(shortcut.sequence))
                    }
                    disabled={!isConnected}
                    className="w-full flex items-center justify-between p-3 rounded-lg bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors border border-transparent hover:border-gray-300 dark:hover:border-gray-600"
                  >
                    <span className="text-sm text-gray-900 dark:text-white">
                      {t(`terminalShortcuts.${shortcut.labelKey}`)}
                    </span>
                    <kbd className="px-2 py-0.5 text-xs font-mono bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded border border-gray-300 dark:border-gray-600">
                      {shortcut.hint}
                    </kbd>
                  </button>
                ))}
              </div>

              {/* Navigation */}
              <div className="space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">
                  {t('terminalShortcuts.sectionNavigation')}
                </h4>
                <button
                  type="button"
                  onMouseDown={preventFocusSteal}
                  onTouchEnd={(e) => handleShortcutTouch(e, scrollToBottom)}
                  onClick={() => handleShortcutAction(scrollToBottom)}
                  disabled={!isConnected}
                  className="w-full flex items-center justify-between p-3 rounded-lg bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors border border-transparent hover:border-gray-300 dark:hover:border-gray-600"
                >
                  <span className="text-sm text-gray-900 dark:text-white">
                    {t('terminalShortcuts.scrollDown')}
                  </span>
                  <ArrowDownToLine className="h-4 w-4 text-gray-600 dark:text-gray-400" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-background/80 backdrop-blur-sm z-30 transition-opacity duration-150 ease-out"
          onMouseDown={preventFocusSteal}
          onTouchEnd={handleToggleTouch}
          onClick={handleToggle}
        />
      )}
    </>
  );
}
