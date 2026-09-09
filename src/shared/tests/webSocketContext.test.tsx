import assert from 'node:assert/strict';

import { act, cleanup, renderHook } from '@testing-library/react';
import React, { useEffect } from 'react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import { WebSocketProvider, useWebSocket } from '@/shared/context/WebSocketContext';
import { AUTH_SESSION_EXPIRED_EVENT } from '@/shared/authToken';
import type { ServerEvent } from '@/shared/types';

const auth = vi.hoisted((): {
  isLoading: boolean;
  token: string | null;
  user: { id: string } | null;
} => ({ isLoading: false, token: 'first-token', user: { id: 'user' } }));
const runtime = vi.hoisted(() => ({ platform: false }));
vi.mock('@/modules/auth', () => ({ useAuth: () => auth }));
vi.mock('@/shared/utils', () => ({ get IS_PLATFORM() { return runtime.platform; } }));

class FakeWebSocket extends EventTarget {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static sockets: FakeWebSocket[] = [];
  static constructorFailures = 0;

  readyState: number = FakeWebSocket.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  sent: Array<{ type?: string; nonce?: string }> = [];
  sendFails = false;

  constructor(readonly url: string) {
    super();
    if (FakeWebSocket.constructorFailures > 0) {
      FakeWebSocket.constructorFailures -= 1;
      throw new Error('Socket construction failed');
    }
    FakeWebSocket.sockets.push(this);
  }

  send(payload: string) {
    if (this.sendFails) throw new Error('Socket send failed');
    assert.equal(this.readyState, FakeWebSocket.OPEN);
    this.sent.push(JSON.parse(payload));
  }

  close = vi.fn(() => {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.(new Event('close'));
  });

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.(new Event('open'));
  }

  receive(frame: unknown) {
    const event = new MessageEvent('message', { data: JSON.stringify(frame) });
    this.onmessage?.(event);
    this.dispatchEvent(event);
  }
}

const wrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(WebSocketProvider, null, children);

function mountProvider() {
  const events: ServerEvent[] = [];
  const hook = renderHook(() => {
    const context = useWebSocket();
    const { subscribe } = context;
    useEffect(() => subscribe((event) => events.push(event)), [subscribe]);
    return context;
  }, { wrapper });
  return { ...hook, events };
}

function currentSocket() {
  const socket = FakeWebSocket.sockets.at(-1);
  assert.ok(socket, 'the provider should construct a socket');
  return socket;
}

function nextDeadline() {
  act(() => { vi.advanceTimersToNextTimer(); });
}

function expectReplacement(original: FakeWebSocket) {
  for (let attempt = 0; attempt < 4 && currentSocket() === original; attempt += 1) {
    nextDeadline();
  }
  assert.notEqual(currentSocket(), original, 'the channel should recover without a page event');
  assert.equal(FakeWebSocket.sockets.length, 2, 'recovery should create only one replacement');
  return currentSocket();
}

function resume() {
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('pageshow'));
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('WebSocket', FakeWebSocket);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  FakeWebSocket.sockets = [];
  FakeWebSocket.constructorFailures = 0;
  auth.isLoading = false;
  auth.token = 'first-token';
  auth.user = { id: 'user' };
  runtime.platform = false;
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test('a half-open channel recovers without resume events and delivers replacement messages', () => {
  const { result, events } = mountProvider();
  const original = currentSocket();
  act(() => original.open());
  assert.equal(result.current.isConnected, true);
  assert.equal(events.length, 0, 'the initial connection is not a reconnect');

  const replacement = expectReplacement(original);
  assert.equal(result.current.isConnected, false);
  const response = { kind: 'session-status', sessionId: 'session', isRunning: true };
  act(() => {
    replacement.open();
    replacement.receive(response);
    result.current.sendMessage({ type: 'chat.subscribe', sessionId: 'session' });
  });
  assert.equal(result.current.isConnected, true);
  assert.equal(result.current.ws, replacement);
  assert.equal(events[0]?.kind, 'websocket_reconnected');
  assert.deepEqual(events.slice(1), [response]);
  assert.deepEqual(replacement.sent, [{ type: 'chat.subscribe', sessionId: 'session' }]);
});

test('matching periodic pongs preserve the socket and never reach subscribers', () => {
  const { events } = mountProvider();
  const socket = currentSocket();
  act(() => socket.open());

  for (let cycle = 0; cycle < 3; cycle += 1) {
    nextDeadline();
    const ping = socket.sent.at(-1);
    assert.equal(ping?.type, 'chat.ping');
    assert.equal(typeof ping?.nonce, 'string');
    act(() => socket.receive({ kind: 'pong', nonce: ping?.nonce }));
    assert.equal(currentSocket(), socket);
  }
  assert.equal(socket.close.mock.calls.length, 0);
  assert.deepEqual(events, []);
});

test('wrong nonces and ordinary traffic cannot satisfy a pending pong', () => {
  const { events } = mountProvider();
  const socket = currentSocket();
  act(() => socket.open());
  resume();
  const ping = socket.sent.at(-1);
  assert.equal(ping?.type, 'chat.ping');
  const response = { kind: 'session-status', nonce: ping?.nonce, sessionId: 'session' };
  act(() => {
    socket.receive({ kind: 'pong', nonce: 'wrong-nonce' });
    socket.receive(response);
  });
  expectReplacement(socket);
  assert.deepEqual(events, [response]);
});

test('repeated page events cannot postpone a pending pong deadline', () => {
  mountProvider();
  const socket = currentSocket();
  act(() => socket.open());
  resume();
  // Keep resuming throughout the timeout, rather than only dispatching both
  // browser events in one tick. Restarting the deadline would never retire it.
  for (let step = 0; step < 20 && socket.close.mock.calls.length === 0; step += 1) {
    act(() => { vi.advanceTimersByTime(500); });
    resume();
  }
  assert.equal(socket.close.mock.calls.length, 1);
  assert.equal(socket.sent.length, 1, 'one pending probe must keep its nonce and deadline');
  expectReplacement(socket);
});

test('closing during a probe removes its deadline and old callbacks cannot clobber the replacement', () => {
  const { result, events } = mountProvider();
  const socket = currentSocket();
  act(() => socket.open());
  resume();
  const lateOpen = socket.onopen;
  const lateClose = socket.onclose;
  const lateMessage = socket.onmessage;
  act(() => socket.close());
  const replacement = expectReplacement(socket);
  act(() => {
    replacement.open();
    lateClose?.(new Event('close'));
    lateOpen?.(new Event('open'));
    lateMessage?.(new MessageEvent('message', { data: JSON.stringify({ kind: 'old-frame' }) }));
    socket.receive({ kind: 'pong', nonce: socket.sent.at(-1)?.nonce });
  });
  assert.equal(result.current.ws, replacement);
  assert.equal(result.current.isConnected, true);
  assert.deepEqual(events.map((event) => event.kind), ['websocket_reconnected']);
  nextDeadline();
  assert.equal(replacement.sent.at(-1)?.type, 'chat.ping');
  assert.equal(replacement.close.mock.calls.length, 0);
});

test('ordinary close retries once and a resumed page does not create a competing connection', () => {
  const { result } = mountProvider();
  const socket = currentSocket();
  act(() => socket.open());
  act(() => socket.close());
  assert.equal(result.current.isConnected, false);
  resume();
  const replacement = expectReplacement(socket);
  resume();
  act(() => replacement.open());
  assert.equal(result.current.ws, replacement);
  assert.equal(FakeWebSocket.sockets.length, 2);
});

test('constructor failure retries without a resume event using the current token', () => {
  FakeWebSocket.constructorFailures = 1;
  const { result, rerender } = mountProvider();
  assert.equal(FakeWebSocket.sockets.length, 0);
  nextDeadline();
  const socket = currentSocket();
  assert.equal(new URL(socket.url).searchParams.get('token'), 'first-token');
  act(() => socket.open());
  act(() => socket.close());
  auth.token = 'replacement-token';
  rerender();
  const replacement = currentSocket();
  assert.notEqual(replacement, socket);
  assert.equal(new URL(replacement.url).searchParams.get('token'), 'replacement-token');
  act(() => replacement.open());
  assert.equal(result.current.ws, replacement);
});

test('stalled handshakes are bounded and late opens cannot publish a retired socket', () => {
  const { result, events } = mountProvider();
  const socket = currentSocket();
  const lateOpen = socket.onopen;
  resume();
  const replacement = expectReplacement(socket);
  act(() => lateOpen?.(new Event('open')));
  assert.equal(result.current.isConnected, false);
  assert.deepEqual(events, []);
  act(() => replacement.open());
  assert.equal(result.current.ws, replacement);
  assert.deepEqual(events, [], 'a failed initial handshake is not a successful prior connection');
});

for (const state of [FakeWebSocket.CLOSING, FakeWebSocket.CLOSED]) {
  test(`a socket silently entering readyState ${state} cannot block recovery`, () => {
    mountProvider();
    const socket = currentSocket();
    act(() => socket.open());
    socket.readyState = state;
    expectReplacement(socket);
  });
}

for (const source of ['probe', 'command']) {
  test(`a ${source} send failure retires the socket and retries`, () => {
    const { result } = mountProvider();
    const socket = currentSocket();
    act(() => socket.open());
    socket.sendFails = true;
    if (source === 'probe') {
      resume();
    } else {
      act(() => result.current.sendMessage({ type: 'chat.subscribe', sessionId: 'session' }));
    }
    assert.equal(result.current.isConnected, false);
    const replacement = expectReplacement(socket);
    act(() => replacement.open());
    assert.equal(result.current.ws, replacement);
  });
}

test('token replacement, logout and unmount cancel probes and reconnect work', () => {
  const { result, rerender, unmount } = mountProvider();
  const socket = currentSocket();
  act(() => socket.open());
  resume();
  auth.token = 'replacement-token';
  rerender();
  const replacement = currentSocket();
  assert.notEqual(replacement, socket);
  assert.equal(socket.readyState, FakeWebSocket.CLOSED);
  assert.equal(result.current.isConnected, false);
  assert.equal(result.current.ws, null, 'consumers must not subscribe while the replacement is connecting');
  act(() => replacement.open());
  assert.equal(result.current.ws, replacement, 'opening must publish the socket so chat subscribes');
  resume();

  auth.token = null;
  auth.user = null;
  rerender();
  assert.equal(result.current.isConnected, false);
  assert.equal(result.current.ws, null);
  assert.equal(replacement.readyState, FakeWebSocket.CLOSED);
  act(() => { vi.advanceTimersByTime(120_000); });
  resume();
  assert.equal(FakeWebSocket.sockets.length, 2);
  assert.equal(vi.getTimerCount(), 0);

  auth.token = 'login-token';
  auth.user = { id: 'user' };
  rerender();
  const loggedIn = currentSocket();
  act(() => loggedIn.open());
  resume();
  unmount();
  act(() => { vi.advanceTimersByTime(120_000); });
  resume();
  assert.equal(loggedIn.readyState, FakeWebSocket.CLOSED);
  assert.equal(FakeWebSocket.sockets.length, 3);
  assert.equal(vi.getTimerCount(), 0);
});

test('unmount cancels a constructor retry', () => {
  FakeWebSocket.constructorFailures = 1;
  const { unmount } = mountProvider();
  unmount();
  act(() => { vi.advanceTimersByTime(120_000); });
  resume();
  assert.equal(FakeWebSocket.sockets.length, 0);
  assert.equal(vi.getTimerCount(), 0);
});

test('OSS auth gates loading, missing user and missing token; platform remains tokenless', () => {
  auth.isLoading = true;
  const { rerender } = mountProvider();
  resume();
  assert.equal(FakeWebSocket.sockets.length, 0);
  auth.isLoading = false;
  auth.user = null;
  rerender();
  resume();
  assert.equal(FakeWebSocket.sockets.length, 0);
  auth.user = { id: 'user' };
  auth.token = null;
  rerender();
  resume();
  assert.equal(FakeWebSocket.sockets.length, 0);
  cleanup();

  runtime.platform = true;
  auth.user = null;
  auth.isLoading = true;
  mountProvider();
  assert.equal(new URL(currentSocket().url).search, '');
});

test('an expired OSS token expires the auth session without opening a channel', () => {
  const payload = btoa(JSON.stringify({ iat: 0, exp: 1 })).replace(/=+$/, '');
  auth.token = `header.${payload}.signature`;
  localStorage.setItem('auth-token', auth.token);
  const expired = vi.fn();
  window.addEventListener(AUTH_SESSION_EXPIRED_EVENT, expired);
  try {
    mountProvider();
    assert.equal(FakeWebSocket.sockets.length, 0);
    assert.equal(localStorage.getItem('auth-token'), null);
    assert.equal(expired.mock.calls.length, 1);
  } finally {
    window.removeEventListener(AUTH_SESSION_EXPIRED_EVENT, expired);
  }
});
