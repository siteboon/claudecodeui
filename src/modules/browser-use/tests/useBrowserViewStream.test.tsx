import assert from 'node:assert/strict';

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import {
  computeContentRect,
  mapClientPointToFrame,
  useBrowserViewStream,
} from '@/modules/browser-use/hooks/useBrowserViewStream';

/**
 * The live-view stream hook turns /browser-view socket traffic into panel
 * state. These tests pin the geometry math used for input takeover and the
 * socket lifecycle: subscribe on open, live state, stale-frame rejection,
 * deliberate close, and unauthorized teardown.
 */

vi.mock('@/modules/auth', () => ({
  useAuth: () => ({ isLoading: false, token: 'test-token', user: { username: 'tester' } }),
}));

/** Minimal WebSocket double recording traffic for assertions. */
type FakeSocket = {
  url: string;
  sent: string[];
  readyState: number;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  close(): void;
  send(data: string): void;
};

type SocketHarness = {
  sockets: FakeSocket[];
};

function createSocketHarness(): SocketHarness {
  const harness: SocketHarness = { sockets: [] };
  vi.stubGlobal('WebSocket', class FakeWebSocket {
    static OPEN = 1;
    static CONNECTING = 0;
    static CLOSING = 2;
    static CLOSED = 3;
    readyState = 1;
    binaryType = 'blob';
    url: string;
    sent: string[] = [];
    onopen: ((event: unknown) => void) | null = null;
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onclose: ((event: unknown) => void) | null = null;
    onerror: ((event: unknown) => void) | null = null;

    constructor(url: string) {
      this.url = url;
      harness.sockets.push(this as unknown as FakeSocket);
    }

    send(data: string) {
      this.sent.push(data);
    }

    close() {
      this.readyState = 3;
      this.onclose?.({});
    }
  });
  return harness;
}

function latestSocket(harness: SocketHarness): FakeSocket {
  return harness.sockets[harness.sockets.length - 1];
}

function openSocket(socket: FakeSocket) {
  socket.onopen?.({});
}

function emitJson(socket: FakeSocket, message: unknown) {
  socket.onmessage?.({ data: JSON.stringify(message) });
}

/** Builds a binary view frame: magic byte, little-endian subscription id, payload. */
function buildFrame(subscriptionId: number, payload: string): ArrayBuffer {
  const buffer = new ArrayBuffer(5 + payload.length);
  const view = new DataView(buffer);
  view.setUint8(0, 0xcf);
  view.setUint32(1, subscriptionId, true);
  for (let index = 0; index < payload.length; index += 1) {
    view.setUint8(5 + index, payload.charCodeAt(index));
  }
  return buffer;
}

function emitBinary(socket: FakeSocket, data: ArrayBuffer) {
  socket.onmessage?.({ data });
}

let blobCounter = 0;
const createdObjectUrls: string[] = [];
let revokeObjectUrl: ReturnType<typeof vi.fn>;

beforeEach(() => {
  // jsdom ships neither object-URL method; both sides of the swap are stubbed.
  const urlConstructor = URL as unknown as Record<string, unknown>;
  urlConstructor.createObjectURL = vi.fn(() => {
    blobCounter += 1;
    const url = `blob:test-${blobCounter}`;
    createdObjectUrls.push(url);
    return url;
  });
  revokeObjectUrl = vi.fn();
  urlConstructor.revokeObjectURL = revokeObjectUrl;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test('computeContentRect letterboxes while preserving aspect ratio', () => {
  // 16:10 frame in a wider container: content height-bound, centered horizontally.
  const wide = computeContentRect(1000, 500, 1280, 800);
  assert.equal(wide.height, 500);
  assert.equal(Math.round(wide.width), 800);
  assert.equal(wide.top, 0);
  assert.equal(Math.round(wide.left), 100);

  // Tall container: width-bound, centered vertically.
  const tall = computeContentRect(400, 900, 1280, 800);
  assert.equal(tall.width, 400);
  assert.equal(Math.round(tall.height), 250);
  assert.equal(tall.left, 0);
  assert.equal(Math.round(tall.top), 325);

  const empty = computeContentRect(0, 0, 1280, 800);
  assert.deepEqual(empty, { left: 0, top: 0, width: 0, height: 0 });
});

test('mapClientPointToFrame maps points and rejects clicks outside the content', () => {
  const rect = { left: 100, top: 0, width: 800, height: 500 };

  const center = mapClientPointToFrame(rect, 500, 250, { left: 0, top: 0 });
  assert.deepEqual(center, { u: 0.5, v: 0.5 });

  const corner = mapClientPointToFrame(rect, 100, 0, { left: 0, top: 0 });
  assert.deepEqual(corner, { u: 0, v: 0 });

  // Letterbox gutters belong to the container, not the page.
  assert.equal(mapClientPointToFrame(rect, 50, 250, { left: 0, top: 0 }), null);
  assert.equal(mapClientPointToFrame(rect, 950, 250, { left: 0, top: 0 }), null);
});

test('hook subscribes on open and reaches live state', async () => {
  const harness = createSocketHarness();
  const { result } = renderHook(() => useBrowserViewStream({ sessionId: 'session-1', active: true }));

  await waitFor(() => assert.equal(harness.sockets.length, 1));
  const socket = latestSocket(harness);
  assert.match(socket.url, /\/browser-view\?token=/);

  openSocket(socket);
  await waitFor(() => assert.ok(socket.sent.some((text) => text.includes('view_subscribe') && text.includes('session-1'))));

  emitJson(socket, { type: 'view_state', subscriptionId: 77, state: 'live', session: { id: 'session-1', status: 'ready' }, viewerCount: 1 });
  await waitFor(() => assert.equal(result.current.status, 'live'));
  assert.equal(result.current.sessionMeta?.id, 'session-1');
  assert.equal(result.current.viewerCount, 1);
});

test('hook accepts frames for the active subscription and drops stale ones', async () => {
  const harness = createSocketHarness();
  const { result } = renderHook(() => useBrowserViewStream({ sessionId: 'session-1', active: true }));
  const socket = latestSocket(harness);
  openSocket(socket);
  emitJson(socket, { type: 'view_state', subscriptionId: 77, state: 'live' });

  emitBinary(socket, buildFrame(76, 'stale'));
  await act(async () => {
    await Promise.resolve();
  });
  assert.equal(result.current.frameUrl, null, 'frames from another subscription must be ignored');

  emitBinary(socket, buildFrame(77, 'live-frame'));
  await waitFor(() => assert.ok(result.current.frameUrl));
});

test('hook stops and reports unauthorized instead of reconnecting', async () => {
  const harness = createSocketHarness();
  const { result } = renderHook(() => useBrowserViewStream({ sessionId: 'session-1', active: true }));
  const socket = latestSocket(harness);
  openSocket(socket);

  emitJson(socket, { type: 'view_error', code: 'unauthorized' });
  await waitFor(() => assert.equal(result.current.status, 'error'));
  assert.equal(result.current.errorCode, 'unauthorized');
  assert.equal(socket.readyState, 3, 'the socket is closed deliberately');

  const socketCount = harness.sockets.length;
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 700));
  });
  assert.equal(harness.sockets.length, socketCount, 'unauthorized never reconnects');
});

test('deactivating pauses and closing the socket deliberately does not reconnect', async () => {
  const harness = createSocketHarness();
  const { rerender, result } = renderHook(
    ({ active }: { active: boolean }) => useBrowserViewStream({ sessionId: 'session-1', active }),
    { initialProps: { active: true } },
  );
  const socket = latestSocket(harness);
  openSocket(socket);
  emitJson(socket, { type: 'view_state', subscriptionId: 5, state: 'live' });
  await waitFor(() => assert.equal(result.current.status, 'live'));

  rerender({ active: false });
  await waitFor(() => assert.equal(result.current.status, 'paused'));
  assert.equal(socket.readyState, 3);

  const socketCount = harness.sockets.length;
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 700));
  });
  assert.equal(harness.sockets.length, socketCount, 'no reconnect attempt after deliberate close');
});

test('sendInput forwards key events immediately and coalesces pointer moves', async () => {
  const harness = createSocketHarness();
  const { result } = renderHook(() => useBrowserViewStream({ sessionId: 'session-1', active: true }));
  const socket = latestSocket(harness);
  openSocket(socket);
  emitJson(socket, { type: 'view_state', subscriptionId: 9, state: 'live' });
  await waitFor(() => assert.equal(result.current.status, 'live'));

  act(() => {
    result.current.sendInput({ kind: 'key', action: 'down', key: 'a', code: 'KeyA', text: 'a' });
    result.current.sendInput({ kind: 'mouse', action: 'move', u: 0.1, v: 0.2, button: 'left' });
    result.current.sendInput({ kind: 'mouse', action: 'move', u: 0.9, v: 0.8, button: 'left' });
  });

  const keyEvents = socket.sent.filter((text) => text.includes('"kind":"key"'));
  assert.equal(keyEvents.length, 1, 'key events go straight through');

  await act(async () => {
    // Let an animation-frame tick flush the coalesced move.
    await new Promise((resolve) => setTimeout(resolve, 60));
  });
  const moves = socket.sent
    .filter((text) => text.includes('"kind":"mouse"') && text.includes('"action":"move"'))
    .map((text) => JSON.parse(text) as { input: { u: number; v: number } });
  assert.equal(moves.length, 1, 'rapid moves collapse into the latest one');
  assert.equal(moves[0].input.u, 0.9);
  assert.equal(moves[0].input.v, 0.8);
});

test('unmount closes the socket and revokes the last frame URL', async () => {
  const harness = createSocketHarness();
  const { result, unmount } = renderHook(() => useBrowserViewStream({ sessionId: 'session-1', active: true }));
  const socket = latestSocket(harness);
  openSocket(socket);
  emitJson(socket, { type: 'view_state', subscriptionId: 12, state: 'live' });
  emitBinary(socket, buildFrame(12, 'frame'));
  await waitFor(() => assert.ok(result.current.frameUrl));

  const lastUrl = result.current.frameUrl;
  unmount();
  assert.equal(socket.readyState, 3);
  await waitFor(() => assert.ok(revokeObjectUrl.mock.calls.some((call: unknown[]) => call[0] === lastUrl)));
});
