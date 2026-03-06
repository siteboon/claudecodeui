import { type MutableRefObject, useState, useCallback, useEffect, useRef } from 'react';
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

const preventFocusSteal = (e: React.PointerEvent) => e.preventDefault();

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
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
    }
    closeTimeoutRef.current = setTimeout(() => setIsOpen(false), 50);
  }, []);

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
        onPointerDown={preventFocusSteal}
        onClick={handleToggle}
        className={`fixed ${
          isOpen ? 'right-64' : 'right-0'
        } z-50 cursor-pointer rounded-l-md border border-gray-200 bg-white p-2 shadow-lg transition-all duration-150 ease-out hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700`}
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
        className={`fixed right-0 top-0 z-40 h-full w-64 transform border-l border-border bg-background shadow-xl transition-transform duration-150 ease-out ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex h-full flex-col">
          {/* Header */}
          <div className="border-b border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900">
            <h3 className="flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-white">
              <Keyboard className="h-5 w-5 text-gray-600 dark:text-gray-400" />
              {t('terminalShortcuts.title')}
            </h3>
          </div>

          {/* Content — conditionally rendered so buttons remount with clean CSS states */}
          {isOpen && (
            <div className="flex-1 space-y-6 overflow-y-auto overflow-x-hidden bg-background p-4">
              {/* Shortcut Keys */}
              <div className="space-y-2">
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  {t('terminalShortcuts.sectionKeys')}
                </h4>
                {SHORTCUTS.map((shortcut) => (
                  <button
                    type="button"
                    key={shortcut.id}
                    onPointerDown={preventFocusSteal}
                    onClick={() => handleShortcutAction(() => sendInput(shortcut.sequence))}
                    disabled={!isConnected}
                    className="flex w-full items-center justify-between rounded-lg border border-transparent bg-gray-50 p-3 transition-colors hover:border-gray-300 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-gray-800 dark:hover:border-gray-600 dark:hover:bg-gray-700"
                  >
                    <span className="text-sm text-gray-900 dark:text-white">
                      {t(`terminalShortcuts.${shortcut.labelKey}`)}
                    </span>
                    <kbd className="rounded border border-gray-300 bg-gray-200 px-2 py-0.5 font-mono text-xs text-gray-600 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300">
                      {shortcut.hint}
                    </kbd>
                  </button>
                ))}
              </div>

              {/* Navigation */}
              <div className="space-y-2">
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  {t('terminalShortcuts.sectionNavigation')}
                </h4>
                <button
                  type="button"
                  onPointerDown={preventFocusSteal}
                  onClick={() => handleShortcutAction(scrollToBottom)}
                  disabled={!isConnected}
                  className="flex w-full items-center justify-between rounded-lg border border-transparent bg-gray-50 p-3 transition-colors hover:border-gray-300 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-gray-800 dark:hover:border-gray-600 dark:hover:bg-gray-700"
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
          className="fixed inset-0 z-30 bg-background/80 backdrop-blur-sm transition-opacity duration-150 ease-out"
          onPointerDown={preventFocusSteal}
          onClick={handleToggle}
        />
      )}
    </>
  );
}
