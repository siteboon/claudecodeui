import assert from 'node:assert/strict';

import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import '@/modules/i18n';
import type { AppTab, Project } from '@/shared/types';

/**
 * Issue #582: a dropped chat socket changed nothing on screen, so the user kept
 * typing into a chat that could not reach the server. The workspace header now
 * says it is reconnecting for as long as the socket is down, on every tab, and
 * shows nothing during the first handshake. Wired as App wires it: the real
 * WebSocketProvider driving the real header.
 */

// Hoisted to a constant so `user` keeps one identity across renders; a fresh
// object would rebuild `connect` and reconnect on every render.
const AUTH = { user: { id: 1 }, token: 'token', isLoading: false };

vi.mock('@/modules/auth', () => ({
  useAuth: () => AUTH,
}));

vi.mock('@/modules/plugins', () => ({
  usePlugins: () => ({ plugins: [] }),
  PluginIcon: () => null,
}));

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((error: unknown) => void) | null = null;

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  send() {}

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

const { WebSocketProvider } = await import('@/shared/context/WebSocketContext');
const { default: WorkspaceHeader } = await import('@/modules/project-workspace/WorkspaceHeader');

const PROJECT: Project = {
  projectId: 'project-1',
  path: '/repo',
  fullPath: '/repo',
  displayName: 'repo',
  isStarred: false,
  sessions: [],
  sessionMeta: { hasMore: false, total: 0 },
};

const header = (activeTab: AppTab) => (
  <WebSocketProvider>
    <WorkspaceHeader
      activeTab={activeTab}
      setActiveTab={() => undefined}
      selectedProject={PROJECT}
      selectedSession={null}
      shouldShowTasksTab={false}
      shouldShowBrowserTab={false}
      isMobile={false}
      onMenuClick={() => undefined}
      onRenameSession={async () => true}
    />
  </WebSocketProvider>
);

const latestSocket = () => FakeWebSocket.instances[FakeWebSocket.instances.length - 1] as FakeWebSocket;
// A boolean, not the element: a failed assertion on a jsdom node makes node:assert
// inspect the whole DOM tree, which can exhaust the worker's memory.
const isIndicatorShown = () => screen.queryByText('Reconnecting...') !== null;
// What a screen reader is told, or null when the header has no polite live region.
const liveRegionText = () => {
  const region = document.querySelector('header [role="status"][aria-live="polite"]');
  return region === null ? null : (region.textContent ?? '');
};

beforeEach(() => {
  vi.useFakeTimers();
  FakeWebSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeWebSocket);
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  Element.prototype.scrollIntoView = () => undefined;
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test('the header shows nothing during the first handshake or while connected', () => {
  render(header('chat'));
  assert.equal(isIndicatorShown(), false, 'no warning while the first handshake is in flight');

  act(() => latestSocket().serverOpens());
  assert.equal(isIndicatorShown(), false);
  // The live region is already there, empty, before anything goes wrong: one
  // inserted together with its text is not reliably announced.
  assert.equal(liveRegionText(), '', 'an empty polite live region is mounted while connected');
});

test('the header says it is reconnecting while the chat socket is down, and clears once it is back', () => {
  const view = render(header('chat'));
  act(() => latestSocket().serverOpens());

  act(() => latestSocket().serverDrops());
  assert.equal(isIndicatorShown(), true, 'a dropped socket is shown');
  assert.equal(liveRegionText(), 'Chat connection lost. Reconnecting...', 'and announced, naming the chat connection');

  // Still down while the retry handshakes, and on another tab too.
  act(() => { vi.advanceTimersByTime(3000); });
  view.rerender(header('files'));
  assert.equal(isIndicatorShown(), true);

  act(() => latestSocket().serverOpens());
  assert.equal(isIndicatorShown(), false, 'the indicator clears once the socket reopens');
  assert.equal(liveRegionText(), '');
});

test('a first connection that fails is shown too', () => {
  render(header('chat'));
  act(() => latestSocket().serverDrops());
  assert.equal(isIndicatorShown(), true);
});
