import { act, renderHook } from '@testing-library/react';
import type { MutableRefObject } from 'react';
import type { FitAddon } from '@xterm/addon-fit';
import type { Terminal } from '@xterm/xterm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useShellConnection } from '@/modules/shell/hooks/useShellConnection';
import type { Project, ProjectSession } from '@/shared/types';

// Only the URL builder is stubbed: it reads a stored auth token and would bail
// before a socket is ever constructed. `parseShellMessage` stays real, because
// what is under test is how a parsed frame is dispatched.
vi.mock('@/modules/shell/utils/socket', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getShellWebSocketUrl: () => 'ws://localhost/shell',
}));

class FakeSocket {
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

const ref = <T,>(value: T): MutableRefObject<T> => ({ current: value });

function renderConnection(currentSessionId: string) {
  const onSessionChange = vi.fn();
  const view = renderHook(() =>
    useShellConnection({
      wsRef: ref<WebSocket | null>(null),
      terminalRef: ref({ write: vi.fn(), cols: 80, rows: 24 } as unknown as Terminal | null),
      fitAddonRef: ref({ fit: vi.fn() } as unknown as FitAddon | null),
      selectedProjectRef: ref<Project | null | undefined>({ fullPath: '/tmp/project', path: '/tmp/project' } as Project),
      selectedSessionRef: ref<ProjectSession | null | undefined>({ id: currentSessionId } as ProjectSession),
      initialCommandRef: ref<string | null | undefined>(null),
      isPlainShellRef: ref(false),
      bypassPermissionsRef: ref(false),
      isDarkModeRef: ref(true),
      onProcessCompleteRef: ref<((exitCode: number) => void) | null | undefined>(null),
      onSessionChangeRef: ref<((sessionId: string) => void) | null | undefined>(onSessionChange),
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
  });

  const receive = (frame: Record<string, unknown>) =>
    act(() => {
      FakeSocket.last?.onmessage?.({ data: JSON.stringify(frame) });
    });
  return { onSessionChange, receive };
}

// `/clear` or `/resume` moves the Claude CLI in the pty to another session;
// the server reports it so the page can show the session the terminal is in.
describe('shell session_changed frames', () => {
  beforeEach(() => {
    FakeSocket.last = null;
    vi.stubGlobal('WebSocket', FakeSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('hands the new session to the host', () => {
    const { onSessionChange, receive } = renderConnection('old-session');

    receive({ type: 'session_changed', sessionId: 'new-session' });

    expect(onSessionChange).toHaveBeenCalledTimes(1);
    expect(onSessionChange).toHaveBeenCalledWith('new-session');
  });

  it('ignores frames for the session already shown or without an id', () => {
    const { onSessionChange, receive } = renderConnection('same-session');

    receive({ type: 'session_changed', sessionId: 'same-session' });
    receive({ type: 'session_changed' });
    receive({ type: 'session_changed', sessionId: 42 });

    expect(onSessionChange).not.toHaveBeenCalled();
  });
});
