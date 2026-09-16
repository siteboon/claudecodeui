import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import React from 'react';
import { beforeEach, test, vi } from 'vitest';

import { useShellTerminal } from '@/modules/shell/hooks/useShellTerminal';
import { ThemeProvider, useTheme } from '@/shared/context/ThemeContext';
import { resetUserPreferences } from '@/shared/userSettings';
import type { Project } from '@/shared/types';

/**
 * The shell terminal used to be built from a single hardcoded dark palette, so
 * the app's light/dark toggle left it dark on a light page. The same bug was
 * fixed for the code editor in #787; xterm is the remaining surface that kept
 * its own theme.
 *
 * Both halves matter. Creating the terminal has to read the theme that is
 * current at that moment, and a later switch has to repaint the terminal that
 * is already open — rebuilding it instead would drop the pty view.
 */

const { terminals } = vi.hoisted(() => ({
  terminals: [] as Array<{ options: Record<string, unknown> }>,
}));

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    options: Record<string, unknown>;
    cols = 80;
    rows = 24;

    constructor(options: Record<string, unknown>) {
      this.options = { ...options };
      terminals.push(this);
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
    dispose() {}
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
vi.mock('@/modules/shell/utils/terminalStyles', () => ({
  ensureXtermFocusStyles: () => {},
}));

// jsdom ships no ResizeObserver, and the hook observes its container.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const project: Project = {
  projectId: 'demo',
  name: 'demo',
  displayName: 'demo',
  path: '/tmp/demo',
  fullPath: '/tmp/demo',
};

const wrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(ThemeProvider, null, children);

/**
 * Mounts the hook inside a real ThemeProvider against a detached container.
 *
 * @returns The `renderHook` result, whose `current` is the theme context, so a
 * test can flip the theme the way the UI's toggle does.
 */
const renderShellTerminal = () => {
  const container = document.createElement('div');
  document.body.appendChild(container);

  return renderHook(
    () => {
      const theme = useTheme();
      const terminalRef = React.useRef(null);
      const fitAddonRef = React.useRef(null);
      const wsRef = React.useRef(null);
      const terminalContainerRef = React.useRef(container);
      // The hook re-creates the terminal when this identity changes, so the
      // real caller memoises it; an inline arrow would remount every render.
      const closeSocket = React.useCallback(() => {}, []);

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
};

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  resetUserPreferences();
  localStorage.clear();
  document.documentElement.classList.remove('dark');
  document.body.innerHTML = '';
  terminals.length = 0;
});

test('a terminal opened in light mode is built with the light palette', () => {
  // The provider defaults to the system preference, and the jsdom matchMedia
  // stub reports light.
  renderShellTerminal();

  assert.equal(terminals.length, 1, 'expected exactly one terminal');
  const theme = terminals[0].options.theme as { background: string };
  assert.equal(theme.background, '#ffffff');
});

test('switching to dark repaints the open terminal instead of rebuilding it', () => {
  const { result } = renderShellTerminal();

  const readBackground = () => (terminals[0].options.theme as { background: string }).background;
  // Asserted before the switch as well: against the old hardcoded palette the
  // terminal is already dark, and the post-switch assertion alone would pass.
  assert.equal(readBackground(), '#ffffff');

  act(() => {
    result.current.toggleDarkMode();
  });

  assert.equal(terminals.length, 1, 'a theme switch must not recreate the terminal');
  const theme = terminals[0].options.theme as { background: string };
  assert.equal(theme.background, '#1e1e1e');
});

test('switching back to light repaints the terminal again', () => {
  const { result } = renderShellTerminal();

  act(() => {
    result.current.toggleDarkMode();
  });
  act(() => {
    result.current.toggleDarkMode();
  });

  assert.equal(terminals.length, 1);
  const theme = terminals[0].options.theme as { background: string };
  assert.equal(theme.background, '#ffffff');
});
