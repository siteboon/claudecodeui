import { type MutableRefObject, useCallback, useState } from 'react';
import {
  Clipboard,
  ArrowDownToLine,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Terminal } from '@xterm/xterm';
import { sendSocketMessage } from '../../utils/socket';

type Shortcut =
  | { type: 'key'; id: string; label: string; sequence: string }
  | { type: 'modifier'; id: string; label: string; modifier: 'ctrl' | 'alt' }
  | { type: 'arrow'; id: string; sequence: string; icon: 'up' | 'down' | 'left' | 'right' };

const MOBILE_KEYS: Shortcut[] = [
  { type: 'key', id: 'esc', label: 'Esc', sequence: '\x1b' },
  { type: 'key', id: 'tab', label: 'Tab', sequence: '\t' },
  { type: 'key', id: 'shift-tab', label: '\u21e7Tab', sequence: '\x1b[Z' },
  { type: 'modifier', id: 'ctrl', label: 'CTRL', modifier: 'ctrl' },
  { type: 'modifier', id: 'alt', label: 'ALT', modifier: 'alt' },
  { type: 'arrow', id: 'arrow-up', sequence: '\x1b[A', icon: 'up' },
  { type: 'arrow', id: 'arrow-down', sequence: '\x1b[B', icon: 'down' },
  { type: 'arrow', id: 'arrow-left', sequence: '\x1b[D', icon: 'left' },
  { type: 'arrow', id: 'arrow-right', sequence: '\x1b[C', icon: 'right' },
];

const ARROW_ICONS = {
  up: ArrowUp,
  down: ArrowDown,
  left: ArrowLeft,
  right: ArrowRight,
} as const;

type TerminalShortcutsPanelProps = {
  wsRef: MutableRefObject<WebSocket | null>;
  terminalRef: MutableRefObject<Terminal | null>;
  isConnected: boolean;
  bottomOffset?: string;
};

const preventFocusSteal = (e: React.PointerEvent) => e.preventDefault();

const KEY_BTN =
  'shrink-0 rounded-md border border-gray-600 bg-gray-700 px-2.5 py-1.5 text-xs font-medium text-gray-100 transition-colors select-none active:bg-blue-600 active:text-white active:border-blue-600 disabled:cursor-not-allowed disabled:opacity-40';
const KEY_BTN_ACTIVE =
  'shrink-0 rounded-md border border-blue-500 bg-blue-600 px-2.5 py-1.5 text-xs font-medium text-white transition-colors select-none disabled:cursor-not-allowed disabled:opacity-40';
const ICON_BTN =
  'shrink-0 rounded-md border border-gray-600 bg-gray-700 p-1.5 text-gray-100 transition-colors select-none active:bg-blue-600 active:text-white active:border-blue-600 disabled:cursor-not-allowed disabled:opacity-40';

export default function TerminalShortcutsPanel({
  wsRef,
  terminalRef,
  isConnected,
  bottomOffset = 'bottom-14',
}: TerminalShortcutsPanelProps) {
  const { t } = useTranslation('settings');
  const [ctrlActive, setCtrlActive] = useState(false);
  const [altActive, setAltActive] = useState(false);

  const sendInput = useCallback(
    (data: string) => {
      sendSocketMessage(wsRef.current, { type: 'input', data });
    },
    [wsRef],
  );

  const scrollToBottom = useCallback(() => {
    terminalRef.current?.scrollToBottom();
  }, [terminalRef]);

  const pasteFromClipboard = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.clipboard?.readText) {
      return;
    }

    try {
      const text = await navigator.clipboard.readText();
      if (text.length > 0) {
        sendInput(text);
      }
    } catch {
      // Ignore clipboard permission errors.
    }
  }, [sendInput]);

  const handleKeyPress = useCallback(
    (seq: string) => {
      let finalSeq = seq;
      if (ctrlActive && seq.length === 1) {
        const code = seq.toLowerCase().charCodeAt(0);
        if (code >= 97 && code <= 122) {
          finalSeq = String.fromCharCode(code - 96);
        }
        setCtrlActive(false);
      }
      if (altActive && seq.length === 1) {
        finalSeq = '\x1b' + finalSeq;
        setAltActive(false);
      }
      sendInput(finalSeq);
    },
    [ctrlActive, altActive, sendInput],
  );

  return (
    <div className={`pointer-events-none fixed inset-x-0 ${bottomOffset} z-20 px-2 md:hidden`}>
      <div className="pointer-events-auto flex items-center gap-1 overflow-x-auto rounded-lg border border-gray-700/80 bg-gray-900/95 px-1.5 py-1.5 shadow-lg backdrop-blur-sm [-webkit-overflow-scrolling:touch] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <button
          type="button"
          onPointerDown={preventFocusSteal}
          onClick={() => {
            void pasteFromClipboard();
          }}
          disabled={!isConnected}
          className={ICON_BTN}
          title={t('terminalShortcuts.paste', { defaultValue: 'Paste' })}
          aria-label={t('terminalShortcuts.paste', { defaultValue: 'Paste' })}
        >
          <Clipboard className="h-4 w-4" />
        </button>

        {MOBILE_KEYS.map((key) => {
          if (key.type === 'modifier') {
            const isActive = key.modifier === 'ctrl' ? ctrlActive : altActive;
            const toggle =
              key.modifier === 'ctrl'
                ? () => setCtrlActive((v) => !v)
                : () => setAltActive((v) => !v);
            return (
              <button
                type="button"
                key={key.id}
                onPointerDown={preventFocusSteal}
                onClick={toggle}
                disabled={!isConnected}
                className={isActive ? KEY_BTN_ACTIVE : KEY_BTN}
              >
                {key.label}
              </button>
            );
          }

          if (key.type === 'arrow') {
            const Icon = ARROW_ICONS[key.icon];
            return (
              <button
                type="button"
                key={key.id}
                onPointerDown={preventFocusSteal}
                onClick={() => sendInput(key.sequence)}
                disabled={!isConnected}
                className={ICON_BTN}
              >
                <Icon className="h-4 w-4" />
              </button>
            );
          }

          return (
            <button
              type="button"
              key={key.id}
              onPointerDown={preventFocusSteal}
              onClick={() => handleKeyPress(key.sequence)}
              disabled={!isConnected}
              className={KEY_BTN}
            >
              {key.label}
            </button>
          );
        })}

        <button
          type="button"
          onPointerDown={preventFocusSteal}
          onClick={scrollToBottom}
          disabled={!isConnected}
          className={ICON_BTN}
          title={t('terminalShortcuts.scrollDown')}
          aria-label={t('terminalShortcuts.scrollDown')}
        >
          <ArrowDownToLine className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
