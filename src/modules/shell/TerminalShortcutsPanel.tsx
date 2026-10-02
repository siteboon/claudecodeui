import { type MutableRefObject, useCallback, useEffect, useRef, useState } from 'react';
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

import { sendSocketMessage } from '@/modules/shell/utils/socket';

type ModifierKey = 'ctrl' | 'alt';
// `armed` applies to the next character only; `locked` to every character
// until the modifier is tapped again.
type ModifierState = 'off' | 'armed' | 'locked';
type Modifiers = Record<ModifierKey, ModifierState>;

type Shortcut =
  | { type: 'key'; id: string; label: string; sequence: string }
  | { type: 'modifier'; id: string; label: string; modifier: ModifierKey }
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
  { type: 'key', id: 'ctrl-c', label: 'Ctrl+C', sequence: '\x03' },
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
  // Lets the bar's CTRL/ALT rewrite what the terminal itself sends, which is
  // where characters typed on the on-screen keyboard go. Without it the
  // modifiers only reach the bar's own keys.
  inputTransformRef?: MutableRefObject<((data: string) => string) | null>;
  isConnected: boolean;
  bottomOffset?: string;
};

const MODIFIERS_OFF: Modifiers = { ctrl: 'off', alt: 'off' };
// A second tap on an armed modifier within this window locks it, so a chord
// that repeats - Claude Code's double Ctrl+C to exit - can be typed at all.
const DOUBLE_TAP_MS = 500;
const MODIFIER_HINTS: Record<ModifierKey, string> = {
  ctrl: 'Ctrl: applies to the next key, double-tap to lock',
  alt: 'Alt: applies to the next key, double-tap to lock',
};

/**
 * Ctrl+letter and Ctrl+@[\]^_ become C0 control characters, as a hardware
 * keyboard sends them; anything else passes through unchanged. ASCII only:
 * toUpperCase() can expand other letters into ones that would map (ß → SS).
 */
function toControlCharacter(char: string): string {
  if (char.charCodeAt(0) > 0x7e) {
    return char;
  }
  const code = char.toUpperCase().charCodeAt(0);
  return code >= 64 && code <= 95 ? String.fromCharCode(code - 64) : char;
}

const preventFocusSteal = (e: React.PointerEvent) => e.preventDefault();

const KEY_BTN =
  'shrink-0 rounded-md border border-gray-600 bg-gray-700 px-2.5 py-1.5 text-xs font-medium text-gray-100 transition-colors select-none active:bg-blue-600 active:text-white active:border-blue-600 disabled:cursor-not-allowed disabled:opacity-40';
const KEY_BTN_LOCKED = 'ring-2 ring-inset ring-white/80';
const KEY_BTN_ACTIVE =
  'shrink-0 rounded-md border border-blue-500 bg-blue-600 px-2.5 py-1.5 text-xs font-medium text-white transition-colors select-none disabled:cursor-not-allowed disabled:opacity-40';
const ICON_BTN =
  'shrink-0 rounded-md border border-gray-600 bg-gray-700 p-1.5 text-gray-100 transition-colors select-none active:bg-blue-600 active:text-white active:border-blue-600 disabled:cursor-not-allowed disabled:opacity-40';

/** Rendered by Shell's full and minimal views to send keys a mobile keyboard cannot produce, such as Esc, Tab, Ctrl and the arrows. */
export default function TerminalShortcutsPanel({
  wsRef,
  terminalRef,
  inputTransformRef,
  isConnected,
  bottomOffset = 'bottom-0',
}: TerminalShortcutsPanelProps) {
  const { t } = useTranslation('settings');
  // Drives how the CTRL/ALT buttons render. The ref mirrors it and is what the
  // terminal's input handler reads, since several characters can arrive
  // between two renders.
  const [modifiers, setModifiers] = useState<Modifiers>(MODIFIERS_OFF);
  const modifiersRef = useRef<Modifiers>(MODIFIERS_OFF);
  const armedAtRef = useRef<Record<ModifierKey, number>>({ ctrl: 0, alt: 0 });

  /** Sets the modifier state, keeping the ref and the rendered state in step. */
  const updateModifiers = useCallback((next: Modifiers) => {
    modifiersRef.current = next;
    setModifiers(next);
  }, []);

  /**
   * Applies the held modifiers to a single typed character and releases the
   * ones that were only armed. Pastes and escape sequences pass through.
   */
  const applyModifiers = useCallback(
    (data: string): string => {
      const current = modifiersRef.current;
      if (data.length !== 1 || (current.ctrl === 'off' && current.alt === 'off')) {
        return data;
      }

      let result = current.ctrl === 'off' ? data : toControlCharacter(data);
      if (current.alt !== 'off') {
        result = '\x1b' + result;
      }

      updateModifiers({
        ctrl: current.ctrl === 'armed' ? 'off' : current.ctrl,
        alt: current.alt === 'armed' ? 'off' : current.alt,
      });
      return result;
    },
    [updateModifiers],
  );

  /**
   * A tap on CTRL/ALT: off → armed; armed → locked when it comes within
   * DOUBLE_TAP_MS of arming, otherwise off; locked → off.
   */
  const tapModifier = useCallback(
    (key: ModifierKey) => {
      const now = performance.now();
      const current = modifiersRef.current[key];
      let next: ModifierState;
      if (current === 'locked') {
        next = 'off';
      } else if (current === 'armed') {
        next = now - armedAtRef.current[key] < DOUBLE_TAP_MS ? 'locked' : 'off';
      } else {
        next = 'armed';
        armedAtRef.current[key] = now;
      }
      updateModifiers({ ...modifiersRef.current, [key]: next });
    },
    [updateModifiers],
  );

  // Restarts and session or project switches all drop the connection. A
  // modifier left on would otherwise rewrite input to the new process.
  useEffect(() => {
    if (!isConnected) {
      updateModifiers(MODIFIERS_OFF);
    }
  }, [isConnected, updateModifiers]);

  // Characters from the on-screen keyboard never pass through this bar's
  // buttons; they reach the terminal directly, so the modifiers are applied
  // there.
  useEffect(() => {
    if (!inputTransformRef) {
      return undefined;
    }
    inputTransformRef.current = applyModifiers;
    return () => {
      if (inputTransformRef.current === applyModifiers) {
        inputTransformRef.current = null;
      }
    };
  }, [applyModifiers, inputTransformRef]);

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

  /** Sends one of the bar's own keys, with any held modifiers applied. */
  const handleKeyPress = useCallback(
    (seq: string) => {
      sendInput(applyModifiers(seq));
    },
    [applyModifiers, sendInput],
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
            const state = modifiers[key.modifier];
            const hint = t(`terminalShortcuts.${key.modifier}`, {
              defaultValue: MODIFIER_HINTS[key.modifier],
            });
            return (
              <button
                type="button"
                key={key.id}
                onPointerDown={preventFocusSteal}
                onClick={() => tapModifier(key.modifier)}
                disabled={!isConnected}
                className={
                  state === 'off'
                    ? KEY_BTN
                    : state === 'locked'
                      ? `${KEY_BTN_ACTIVE} ${KEY_BTN_LOCKED}`
                      : KEY_BTN_ACTIVE
                }
                aria-pressed={state !== 'off'}
                title={hint}
                aria-label={hint}
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
