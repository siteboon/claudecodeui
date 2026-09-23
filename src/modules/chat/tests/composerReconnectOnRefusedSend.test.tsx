import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import '@/modules/i18n';
import type { PermissionMode, Project, ProjectSession } from '@/shared/types';

/**
 * The composer refuses a send while the chat socket is closed without handing
 * it to `sendMessage`, so the socket's own "a refused send reconnects at once"
 * never ran for the path the user actually takes: the "Reconnecting" notice
 * still waited out the full 3 s delay, and a retry inside it failed again.
 * Wired as ChatInterface wires it: the real provider feeding the real hook.
 */

// Hoisted to a constant so `user` keeps one identity across renders; a fresh
// object would rebuild `connect` and reconnect on every render.
const AUTH = { user: { id: 1 }, token: 'token', isLoading: false };

vi.mock('@/modules/auth', () => ({
  useAuth: () => AUTH,
}));

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.CONNECTING;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((error: unknown) => void) | null = null;

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED;
  }

  serverOpens() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  serverDrops() {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.();
  }
}

const { WebSocketProvider, useWebSocket } = await import('@/shared/context/WebSocketContext');
const { useChatComposerState } = await import('@/modules/chat/hooks/useChatComposerState');

const PROJECT: Project = { projectId: 'project-1', displayName: 'Project One', fullPath: '/tmp/project-one' };
const SESSION: ProjectSession = { id: 'session-1' };

const wrapper = ({ children }: { children: ReactNode }) => <WebSocketProvider>{children}</WebSocketProvider>;

const useWiredComposer = () => {
  const { sendMessage, isConnected, reconnectNow } = useWebSocket();
  return useChatComposerState({
    selectedProject: PROJECT,
    selectedSession: SESSION,
    currentSessionId: SESSION.id as string,
    provider: 'claude',
    permissionMode: 'default',
    cyclePermissionMode: () => undefined,
    resolvePermissionModeForProvider: () => 'default' as PermissionMode,
    currentProviderModel: 'test-model',
    currentProviderEffort: 'medium',
    isLoading: false,
    canAbortSession: false,
    tokenBudget: null,
    sendMessage,
    isConnected,
    reconnectNow,
    scrollToBottom: () => undefined,
    addMessage: () => undefined,
    setIsUserScrolledUp: () => undefined,
    setPendingPermissionRequests: () => undefined,
  });
};

const latestSocket = () => FakeWebSocket.instances[FakeWebSocket.instances.length - 1] as FakeWebSocket;

beforeEach(() => {
  FakeWebSocket.instances = [];
  localStorage.clear();
  vi.stubGlobal('WebSocket', FakeWebSocket);
  vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { status: 200 })));
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

test('a send refused while disconnected reconnects at once, and the kept message goes out on the new socket', async () => {
  const view = renderHook(useWiredComposer, { wrapper });
  act(() => latestSocket().serverOpens());
  // The server terminated the socket (missed heartbeat while the tab slept).
  act(() => latestSocket().serverDrops());
  assert.equal(FakeWebSocket.instances.length, 1, 'the reconnect is waiting out its delay');

  await act(async () => { view.result.current.setInput('hello'); });
  await act(async () => { await view.result.current.handleSubmit({ preventDefault: () => undefined } as never); });

  assert.equal(view.result.current.showNotConnectedNotice, true);
  assert.equal(view.result.current.input, 'hello');
  assert.equal(FakeWebSocket.instances.length, 2, 'the refused send started the reconnect without waiting');

  // A second attempt while that socket is still connecting opens no other one.
  await act(async () => { await view.result.current.handleSubmit({ preventDefault: () => undefined } as never); });
  assert.equal(FakeWebSocket.instances.length, 2);

  act(() => latestSocket().serverOpens());
  assert.equal(view.result.current.showNotConnectedNotice, false, 'the notice goes once the socket is back');

  await act(async () => { await view.result.current.handleSubmit({ preventDefault: () => undefined } as never); });
  const frames = latestSocket().sent.map((frame) => JSON.parse(frame) as { type: string; content?: string });
  assert.deepEqual(
    frames.filter((frame) => frame.type === 'chat.send').map((frame) => frame.content),
    ['hello'],
  );
  assert.equal(view.result.current.input, '');

  view.unmount();
});
