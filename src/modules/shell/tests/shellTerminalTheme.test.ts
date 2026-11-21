import assert from 'node:assert/strict';

import { act, render, renderHook } from '@testing-library/react';
import React from 'react';
import type { MutableRefObject } from 'react';
import type { FitAddon } from '@xterm/addon-fit';
import type { ITheme, Terminal } from '@xterm/xterm';
import { afterEach, beforeEach, test, vi } from 'vitest';

import { useShellConnection } from '@/modules/shell/hooks/useShellConnection';
import { useShellRuntime } from '@/modules/shell/hooks/useShellRuntime';
import { useShellTerminal } from '@/modules/shell/hooks/useShellTerminal';
import { ThemeProvider, useTheme } from '@/shared/context/ThemeContext';
import { TERMINAL_INIT_DELAY_MS } from '@/shared/constants';
import type { Project, ProjectSession } from '@/shared/types';
import { resetUserPreferences, writeUserPreference } from '@/shared/userSettings';

/**
 * The Shell tab used to build xterm from one hard-coded dark palette, so the
 * app's light/dark toggle never reached the terminal (#1335). Three things have
 * to hold: a terminal opens in the app's current theme, a toggle repaints the
 * terminal that is already open instead of rebuilding it (which would close the
 * socket and drop the running session), and the CLI started behind it is told
 * which scheme it is being drawn in.
 */

type FakeTerminal = {
  options: {
    theme?: ITheme;
    minimumContrastRatio?: number;
  };
  disposed: boolean;
};

const { terminals } = vi.hoisted(() => ({ terminals: [] as FakeTerminal[] }));

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    options: Record<string, unknown>;
    cols = 80;
    rows = 24;
    disposed = false;

    constructor(options: Record<string, unknown>) {
      this.options = { ...options };
      terminals.push(this as unknown as FakeTerminal);
    }

    loadAddon() {}
    open() {}
    attachCustomKeyEventHandler() {}
    onData() {
      return { dispose() {} };
    }
    getSelection() {
      return '';
    }
    hasSelection() {
      return false;
    }
    clear() {}
    write() {}
    refresh() {}
    dispose() {
      this.disposed = true;
    }
  },
}));
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit() {}
  },
}));
vi.mock('@xterm/addon-clipboard', () => ({ ClipboardAddon: class {} }));
vi.mock('@xterm/addon-web-links', () => ({ WebLinksAddon: class {} }));
vi.mock('@xterm/addon-webgl', () => ({ WebglAddon: class {} }));
vi.mock('@/modules/shell/utils/mobileTerminalSelection', () => ({
  installMobileTerminalSelection: () => ({ dispose() {} }),
}));
// Only the URL builder is stubbed: it reads a stored auth token and would bail
// before a socket is ever constructed.
vi.mock('@/modules/shell/utils/socket', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getShellWebSocketUrl: () => 'ws://localhost/shell',
}));

// jsdom ships no ResizeObserver, and the terminal hook observes its container.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

class FakeSocket {
  static OPEN = 1;
  static last: FakeSocket | null = null;

  readyState = 1;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  sent: string[] = [];

  constructor() {
    FakeSocket.last = this;
  }

  send(payload: string) {
    this.sent.push(payload);
  }

  close() {
    this.readyState = 3;
  }
}

const project = {
  projectId: 'demo',
  name: 'demo',
  displayName: 'demo',
  path: '/tmp/demo',
  fullPath: '/tmp/demo',
} as Project;

const ref = <T,>(value: T): MutableRefObject<T> => ({ current: value });

const wrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(ThemeProvider, null, children);

/** Mounts the terminal hook inside the real ThemeProvider; `result.current` is the theme context. */
function renderShellTerminal() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const closeSocket = vi.fn();

  const view = renderHook(
    () => {
      const theme = useTheme();
      const terminalContainerRef = React.useRef<HTMLDivElement>(container);
      const terminalRef = React.useRef<Terminal | null>(null);
      const fitAddonRef = React.useRef<FitAddon | null>(null);
      const wsRef = React.useRef<WebSocket | null>(null);

      useShellTerminal({
        terminalContainerRef,
        terminalRef,
        fitAddonRef,
        wsRef,
        selectedProject: project,
        minimal: false,
        isRestarting: false,
        closeSocket,
      });

      return theme;
    },
    { wrapper },
  );

  return { ...view, closeSocket };
}

function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16) / 255);
  const [red, green, blue] = channels.map((channel) =>
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/** WCAG 2 contrast ratio between two `#rrggbb` colours. */
function contrastRatio(first: string, second: string): number {
  const [lighter, darker] = [relativeLuminance(first), relativeLuminance(second)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  vi.stubGlobal('WebSocket', FakeSocket);
  localStorage.clear();
  // The preference store is a module-level singleton that outlives localStorage.clear().
  resetUserPreferences();
  document.documentElement.classList.remove('dark');
  document.body.innerHTML = '';
  terminals.length = 0;
  FakeSocket.last = null;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test('a terminal opened in light mode is painted with the light palette', () => {
  writeUserPreference('theme', 'light');

  renderShellTerminal();

  assert.equal(terminals.length, 1);
  assert.equal(terminals[0].options.theme?.background, '#ffffff');
  // Truecolor accents that CLIs pick for a dark background get darkened on white.
  assert.equal(terminals[0].options.minimumContrastRatio, 4.5);
});

test('a terminal opened in dark mode keeps the existing dark palette', () => {
  writeUserPreference('theme', 'dark');

  renderShellTerminal();

  assert.equal(terminals.length, 1);
  assert.equal(terminals[0].options.theme?.background, '#1e1e1e');
  assert.equal(terminals[0].options.minimumContrastRatio, 1);
});

test('toggling the theme repaints the open terminal without rebuilding it or closing its socket', () => {
  writeUserPreference('theme', 'light');
  const { result, closeSocket } = renderShellTerminal();
  assert.equal(terminals[0].options.theme?.background, '#ffffff');

  act(() => {
    result.current.toggleDarkMode();
  });

  assert.equal(terminals.length, 1, 'a theme switch must not create a second terminal');
  assert.equal(terminals[0].disposed, false, 'the running terminal must not be disposed');
  assert.equal(closeSocket.mock.calls.length, 0, 'the pty socket must stay open');
  assert.equal(terminals[0].options.theme?.background, '#1e1e1e');
  assert.equal(terminals[0].options.minimumContrastRatio, 1);

  act(() => {
    result.current.toggleDarkMode();
  });

  assert.equal(terminals.length, 1);
  assert.equal(terminals[0].options.theme?.background, '#ffffff');
  assert.equal(terminals[0].options.minimumContrastRatio, 4.5);
});

test('every ANSI colour of the light palette stays readable on its background', () => {
  writeUserPreference('theme', 'light');
  renderShellTerminal();
  const theme = terminals[0].options.theme as ITheme & Record<string, string>;
  const background = theme.background as string;
  assert.ok(relativeLuminance(background) > 0.5, `expected a light background, got ${background}`);

  assert.ok(contrastRatio(theme.foreground as string, background) >= 7);
  const readableAsText = [
    'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan',
    'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan',
  ];
  for (const name of readableAsText) {
    const ratio = contrastRatio(theme[name], background);
    assert.ok(ratio >= 4.5, `${name} ${theme[name]} is only ${ratio.toFixed(2)}:1 on ${background}`);
  }
  // Light palettes keep "white" greyish; it still has to show up as text.
  for (const name of ['white', 'brightWhite']) {
    const ratio = contrastRatio(theme[name], background);
    assert.ok(ratio >= 3, `${name} ${theme[name]} is only ${ratio.toFixed(2)}:1 on ${background}`);
  }
});

test('the shell init message tells the server which colour scheme the terminal is in', () => {
  vi.useFakeTimers();
  const isDarkModeRef = ref(false);

  const view = renderHook(() =>
    useShellConnection({
      wsRef: ref<WebSocket | null>(null),
      terminalRef: ref({ write: vi.fn(), cols: 80, rows: 24 } as unknown as Terminal | null),
      fitAddonRef: ref({ fit: vi.fn() } as unknown as FitAddon | null),
      selectedProjectRef: ref<Project | null | undefined>(project),
      selectedSessionRef: ref<ProjectSession | null | undefined>(null),
      initialCommandRef: ref<string | null | undefined>(null),
      isPlainShellRef: ref(false),
      bypassPermissionsRef: ref(false),
      isDarkModeRef,
      onProcessCompleteRef: ref<((exitCode: number) => void) | null | undefined>(null),
      isInitialized: true,
      autoConnect: false,
      closeSocket: vi.fn(),
      clearTerminalScreen: vi.fn(),
    }),
  );

  act(() => {
    view.result.current.connectToShell();
  });
  act(() => {
    FakeSocket.last?.onopen?.();
    vi.advanceTimersByTime(TERMINAL_INIT_DELAY_MS);
  });

  const initFrame = JSON.parse(FakeSocket.last?.sent[0] ?? '{}') as Record<string, unknown>;
  assert.equal(initFrame.type, 'init');
  assert.equal(initFrame.colorScheme, 'light');
});

type ShellRuntimeView = {
  runtime: ReturnType<typeof useShellRuntime>;
  theme: ReturnType<typeof useTheme>;
};

/** Renders the shell runtime with a real terminal container, the way Shell does. */
function ShellRuntimeHarness({ onRender }: { onRender: (view: ShellRuntimeView) => void }) {
  const theme = useTheme();
  const runtime = useShellRuntime({
    selectedProject: project,
    selectedSession: null,
    initialCommand: null,
    isPlainShell: false,
    bypassPermissions: false,
    minimal: false,
    autoConnect: false,
    isRestarting: false,
  });
  React.useEffect(() => {
    onRender({ runtime, theme });
  });
  return React.createElement('div', { ref: runtime.terminalContainerRef });
}

/** Mounts the harness; the returned getter reads the latest committed render. */
function renderShellRuntime(): () => ShellRuntimeView {
  let latest: ShellRuntimeView | null = null;
  const onRender = (view: ShellRuntimeView) => {
    latest = view;
  };
  render(React.createElement(ThemeProvider, null, React.createElement(ShellRuntimeHarness, { onRender })));
  return () => latest as unknown as ShellRuntimeView;
}

/** Opens a shell socket and returns a function that plays the server's launch-theme frame. */
function connectShell(current: () => ShellRuntimeView) {
  act(() => {
    current().runtime.connectToShell();
  });
  const socket = FakeSocket.last as FakeSocket;
  act(() => {
    socket.onopen?.();
    vi.advanceTimersByTime(TERMINAL_INIT_DELAY_MS);
  });
  const reportLaunchTheme = (colorScheme: string) =>
    act(() => {
      socket.onmessage?.({ data: JSON.stringify({ type: 'claude_theme', colorScheme }) });
    });
  return { socket, reportLaunchTheme };
}

// A running Claude CLI keeps the colours it was launched with, so right after a
// toggle it still shows the look the theme was changed away from (#1335).
test('a Claude CLI launched in the other theme asks for a restart until the themes match', () => {
  vi.useFakeTimers();
  writeUserPreference('theme', 'light');
  const current = renderShellRuntime();
  const { socket, reportLaunchTheme } = connectShell(current);
  const toggle = () =>
    act(() => {
      current().theme.toggleDarkMode();
    });

  reportLaunchTheme('light');
  assert.equal(current().runtime.isClaudeThemeOutdated, false, 'launched in the current theme');

  toggle();
  assert.equal(current().runtime.isClaudeThemeOutdated, true, 'the CLI still draws its light theme');

  toggle();
  assert.equal(current().runtime.isClaudeThemeOutdated, false, 'back in the theme it launched in');

  toggle();
  assert.equal(current().runtime.isClaudeThemeOutdated, true);

  // Restart: the old socket closes, and the new launch reports the current theme.
  act(() => {
    socket.onclose?.();
  });
  assert.equal(current().runtime.isClaudeThemeOutdated, false, 'no CLI is running');
  connectShell(current).reportLaunchTheme('dark');
  assert.equal(current().runtime.isClaudeThemeOutdated, false, 'the restarted CLI matches');
});

test('a reattached CLI started in the other theme asks for a restart at once', () => {
  vi.useFakeTimers();
  writeUserPreference('theme', 'light');
  const current = renderShellRuntime();

  // The server reports the theme of the pty it reattached to, not the one just sent.
  connectShell(current).reportLaunchTheme('dark');

  assert.equal(current().runtime.isClaudeThemeOutdated, true);
});

test('shells that are not a themed Claude launch never ask for a restart', () => {
  vi.useFakeTimers();
  writeUserPreference('theme', 'light');
  const current = renderShellRuntime();
  // The server sends no launch theme for plain shells, Codex and the like.
  const { reportLaunchTheme } = connectShell(current);

  act(() => {
    current().theme.toggleDarkMode();
  });
  assert.equal(current().runtime.isClaudeThemeOutdated, false);

  reportLaunchTheme('sepia');
  assert.equal(current().runtime.isClaudeThemeOutdated, false, 'an unknown value is ignored');
});
