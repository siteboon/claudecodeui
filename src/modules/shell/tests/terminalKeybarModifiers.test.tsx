import { act, fireEvent, render, screen } from '@testing-library/react';
import type { MutableRefObject } from 'react';
import type { Terminal } from '@xterm/xterm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import TerminalShortcutsPanel from '@/modules/shell/TerminalShortcutsPanel';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key,
  }),
}));

type Transform = (data: string) => string;

let now = 0;
let sent: string[] = [];

function renderPanel() {
  sent = [];
  const socket = {
    readyState: WebSocket.OPEN,
    send: (payload: string) => sent.push(JSON.parse(payload).data),
  } as unknown as WebSocket;
  const inputTransformRef: MutableRefObject<Transform | null> = { current: null };
  const { unmount } = render(
    <TerminalShortcutsPanel
      wsRef={{ current: socket }}
      terminalRef={{ current: null as Terminal | null }}
      inputTransformRef={inputTransformRef}
      isConnected
    />,
  );
  // What the terminal does with a character typed on the on-screen keyboard.
  const type = (data: string) => {
    let out = data;
    act(() => {
      out = inputTransformRef.current ? inputTransformRef.current(data) : data;
    });
    return out;
  };
  return { inputTransformRef, type, unmount };
}

const BUTTON_NAMES = { CTRL: /^Ctrl:/, ALT: /^Alt:/, Tab: 'Tab' } as const;

// Taps a key bar button `afterMs` after the previous tap.
function tap(label: keyof typeof BUTTON_NAMES, afterMs = 100) {
  now += afterMs;
  fireEvent.click(screen.getByRole('button', { name: BUTTON_NAMES[label] }));
}

function ctrlButton() {
  return screen.getByRole('button', { name: /^Ctrl:/ });
}

describe('TerminalShortcutsPanel modifiers', () => {
  beforeEach(() => {
    now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
  });

  it('applies an armed CTRL to the next character from the on-screen keyboard, then releases it', () => {
    const { type } = renderPanel();

    tap('CTRL');
    expect(ctrlButton().getAttribute('aria-pressed')).toBe('true');
    expect(type('c')).toBe('\x03');
    expect(ctrlButton().getAttribute('aria-pressed')).toBe('false');
    expect(type('c')).toBe('c');
  });

  it('maps CTRL with the C0 punctuation keys and prefixes ALT with ESC', () => {
    const { type } = renderPanel();

    tap('CTRL');
    expect(type('[')).toBe('\x1b');
    tap('ALT', 1000);
    expect(type('b')).toBe('\x1bb');
    tap('CTRL', 1000);
    tap('ALT', 1000);
    expect(type('d')).toBe('\x1b\x04');
  });

  it('leaves non-ASCII characters alone under CTRL', () => {
    const { type } = renderPanel();

    // 'ß'.toUpperCase() is 'SS', which must not turn into ^S.
    tap('CTRL');
    expect(type('ß')).toBe('ß');
    tap('CTRL', 1000);
    expect(type('ж')).toBe('ж');
  });

  it('locks a modifier on a double tap until it is tapped again', () => {
    const { type } = renderPanel();

    tap('CTRL');
    tap('CTRL', 200);
    expect(ctrlButton().className).toContain('ring-2');
    expect(type('c')).toBe('\x03');
    expect(type('c')).toBe('\x03');

    tap('CTRL', 1000);
    expect(ctrlButton().getAttribute('aria-pressed')).toBe('false');
    expect(type('c')).toBe('c');
  });

  it('does not lock on two slow taps, or when a key was spent in between', () => {
    const { type } = renderPanel();

    tap('CTRL');
    tap('CTRL', 700);
    expect(ctrlButton().getAttribute('aria-pressed')).toBe('false');

    tap('CTRL', 1000);
    expect(type('d')).toBe('\x04');
    tap('CTRL', 100);
    expect(type('d')).toBe('\x04');
    expect(ctrlButton().getAttribute('aria-pressed')).toBe('false');
  });

  it('lets pastes and escape sequences through without spending the modifier', () => {
    const { type } = renderPanel();

    tap('CTRL');
    expect(type('hello')).toBe('hello');
    expect(type('\x1b[A')).toBe('\x1b[A');
    expect(type('a')).toBe('\x01');
  });

  it('still applies the modifiers to the bar\'s own keys', () => {
    renderPanel();

    tap('ALT');
    tap('Tab', 1000);
    expect(sent).toEqual(['\x1b\t']);
  });

  it('stops rewriting input once unmounted', () => {
    const { inputTransformRef, unmount } = renderPanel();
    expect(inputTransformRef.current).not.toBeNull();

    unmount();
    expect(inputTransformRef.current).toBeNull();
  });
});
