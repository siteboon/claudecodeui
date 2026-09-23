import assert from 'node:assert/strict';

import { act, render } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, test, vi } from 'vitest';

/**
 * `sendMessage` used to drop a frame on a closed socket with nothing but a
 * console warning and no return value, so the chat composer could not tell a
 * sent prompt from a lost one. It now reports whether the frame went out, and a
 * refused send skips the remaining reconnect delay.
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

let context: ReturnType<typeof useWebSocket> | null = null;

function CaptureContext() {
  const value = useWebSocket();
  useEffect(() => {
    context = value;
  });
  return null;
}

const latestSocket = () => FakeWebSocket.instances[FakeWebSocket.instances.length - 1] as FakeWebSocket;

beforeEach(() => {
  FakeWebSocket.instances = [];
  context = null;
  vi.stubGlobal('WebSocket', FakeWebSocket);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test('sendMessage reports whether the frame went out, and a refused send reconnects at once', async () => {
  const view = render(<WebSocketProvider><CaptureContext /></WebSocketProvider>);
  assert.equal(FakeWebSocket.instances.length, 1);

  const first = latestSocket();
  act(() => first.serverOpens());
  assert.equal(context?.sendMessage({ type: 'chat.send', content: 'hello' }), true);
  assert.deepEqual(first.sent, [JSON.stringify({ type: 'chat.send', content: 'hello' })]);

  // The server terminated the socket (missed heartbeat while the tab slept).
  act(() => first.serverDrops());
  assert.equal(context?.isConnected, false);

  assert.equal(context?.sendMessage({ type: 'chat.send', content: 'lost?' }), false);
  assert.equal(first.sent.length, 1, 'nothing is written to the closed socket');
  // Without waiting out the 3 s reconnect delay.
  assert.equal(FakeWebSocket.instances.length, 2, 'a refused send starts the reconnect immediately');

  const second = latestSocket();
  act(() => second.serverOpens());
  assert.equal(context?.sendMessage({ type: 'chat.send', content: 'again' }), true);
  assert.equal(second.sent.length, 1);

  view.unmount();
});

test('a refused send while the new socket is still connecting does not open another one', async () => {
  const view = render(<WebSocketProvider><CaptureContext /></WebSocketProvider>);
  assert.equal(FakeWebSocket.instances.length, 1);

  assert.equal(context?.sendMessage({ type: 'chat.send' }), false);
  assert.equal(FakeWebSocket.instances.length, 1);

  view.unmount();
});
