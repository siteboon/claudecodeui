import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Shell from '@/modules/shell/Shell';
import type { Project } from '@/shared/types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

vi.mock('@/modules/chat', () => ({
  getClaudeSettings: () => ({ skipPermissions: false }),
}));

// xterm needs a real canvas and layout; only the input path matters here, so a
// stand-in terminal exposes the onData listener the Shell registers.
vi.mock('@xterm/xterm', () => {
  class FakeTerminal {
    static last: FakeTerminal | null = null;
    cols = 80;
    rows = 24;
    element: HTMLElement | undefined;
    options: Record<string, unknown>;
    emitData: (data: string) => void = () => {};

    constructor(options: Record<string, unknown>) {
      this.options = { ...options };
      FakeTerminal.last = this;
    }

    open(container: HTMLElement) {
      this.element = document.createElement('div');
      container.appendChild(this.element);
    }

    onData(listener: (data: string) => void) {
      this.emitData = listener;
      return { dispose: () => {} };
    }

    loadAddon() {}
    attachCustomKeyEventHandler() {}
    focus() {}
    clear() {}
    write() {}
    refresh() {}
    scrollToBottom() {}
    dispose() {}
  }
  return { Terminal: FakeTerminal };
});
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit() {} } }));
vi.mock('@xterm/addon-web-links', () => ({ WebLinksAddon: class {} }));
vi.mock('@xterm/addon-webgl', () => ({ WebglAddon: class {} }));
vi.mock('@xterm/addon-clipboard', () => ({ ClipboardAddon: class {} }));
vi.mock('@/modules/shell/utils/mobileTerminalSelection', () => ({
  installMobileTerminalSelection: () => null,
}));
vi.mock('@/modules/shell/utils/socket', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getShellWebSocketUrl: () => 'ws://localhost/shell',
}));

class FakeSocket {
  static readonly OPEN = 1;
  static last: FakeSocket | null = null;

  readyState = 1;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  inputs: string[] = [];

  constructor() {
    FakeSocket.last = this;
  }

  send(payload: string) {
    const message = JSON.parse(payload);
    if (message.type === 'input') {
      this.inputs.push(message.data);
    }
  }

  close() {
    this.readyState = 3;
  }
}

class FakeResizeObserver {
  observe() {}
  disconnect() {}
}

const PROJECT = {
  name: 'demo',
  displayName: 'demo',
  path: '/tmp/demo',
  fullPath: '/tmp/demo',
} as unknown as Project;

/** Renders a connected plain Shell and returns its socket and fake terminal. */
async function renderConnectedShell() {
  render(<Shell selectedProject={PROJECT} isPlainShell autoConnect />);
  const { Terminal } = (await import('@xterm/xterm')) as unknown as {
    Terminal: { last: { emitData: (data: string) => void } | null };
  };
  const socket = FakeSocket.last!;
  act(() => {
    socket.onopen?.();
  });
  return { socket, terminal: Terminal.last! };
}

describe('Shell key bar and the on-screen keyboard', () => {
  beforeEach(() => {
    FakeSocket.last = null;
    vi.stubGlobal('WebSocket', FakeSocket);
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends ^C when CTRL is armed and "c" arrives from the terminal', async () => {
    const { socket, terminal } = await renderConnectedShell();

    fireEvent.click(screen.getByRole('button', { name: /^Ctrl:/ }));
    act(() => {
      terminal.emitData('c');
    });
    act(() => {
      terminal.emitData('c');
    });

    // Armed once: the first keystroke is modified, the second is not.
    expect(socket.inputs).toEqual(['\x03', 'c']);
  });
});
