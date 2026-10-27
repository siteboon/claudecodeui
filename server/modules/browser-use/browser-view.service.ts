import { randomInt } from 'node:crypto';

import type { WebSocket } from 'ws';

import { browserUseService } from '@/modules/browser-use/browser-use.service.js';

/**
 * Live view streaming for managed agent browser sessions.
 *
 * Capture uses the Chrome DevTools Protocol screencast interface, which emits
 * already-encoded JPEG frames of the active page: the server does no decoding
 * or re-encoding, and idle pages naturally stop producing frames. Frames are
 * forwarded to authenticated viewer WebSockets as binary messages, conflated to
 * a configurable frame-rate ceiling per subscriber so latency and memory stay
 * bounded regardless of how fast the page repaints.
 *
 * Lifecycle invariant: starting or stopping capture never closes the agent's
 * browser. Capture begins with the first subscriber and stops (after a
 * debounce) when the last subscriber leaves, by detaching the CDP session only.
 */

const MAX_FPS = clampInt(process.env.CLOUDCLI_BROWSER_VIEW_MAX_FPS, 1, 30, 15);
const JPEG_QUALITY = clampInt(process.env.CLOUDCLI_BROWSER_VIEW_JPEG_QUALITY, 20, 100, 70);
const MAX_FRAME_WIDTH = clampInt(process.env.CLOUDCLI_BROWSER_VIEW_MAX_WIDTH, 320, 3840, 1280);
const MAX_FRAME_HEIGHT = clampInt(process.env.CLOUDCLI_BROWSER_VIEW_MAX_HEIGHT, 240, 2160, 800);
const STOP_DEBOUNCE_MS = clampInt(process.env.CLOUDCLI_BROWSER_VIEW_STOP_DEBOUNCE_MS, 0, 60_000, 3_000);
const MAX_SUBSCRIBERS_PER_SESSION = clampInt(process.env.CLOUDCLI_BROWSER_VIEW_MAX_SUBSCRIBERS, 1, 16, 4);
const INPUT_EVENTS_PER_SECOND = clampInt(process.env.CLOUDCLI_BROWSER_VIEW_INPUT_MAX_PER_SECOND, 10, 1_000, 120);
const METADATA_INTERVAL_MS = 2_000;
/** Base interval between capture pulls; idle pages back off toward IDLE_INTERVAL_MS. */
const CAPTURE_INTERVAL_MS = Math.max(16, Math.round(1000 / MAX_FPS));
const IDLE_INTERVAL_MS = 500;
/** Consecutive identical frames before the capture loop slows down. */
const IDLE_FRAMES_THRESHOLD = 5;

/** Normalized pointer position within a captured frame, each component in [0, 1]. */
type FramePoint = { u: number; v: number };

export type BrowserViewInputEvent =
  | { kind: 'mouse'; action: 'move' | 'down' | 'up'; u: number; v: number; button: 'left' | 'right' | 'middle'; clickCount?: number; modifiers?: InputModifiers }
  | { kind: 'wheel'; u: number; v: number; deltaX: number; deltaY: number; modifiers?: InputModifiers }
  | { kind: 'key'; action: 'down' | 'up'; key: string; code?: string; text?: string; repeat?: boolean; location?: number; modifiers?: InputModifiers }
  | { kind: 'text'; text: string };

type InputModifiers = ('alt' | 'ctrl' | 'meta' | 'shift')[];

/** A compressed frame as emitted by CDP screencast, shared by all hub subscribers. */
type CapturedFrame = {
  jpeg: Buffer;
};

/** Latest CDP screencast metadata, used to translate normalized frame coordinates into viewport CSS pixels. */
type FrameGeometry = {
  pageScaleFactor: number;
  deviceWidth: number;
  deviceHeight: number;
  offsetX: number;
  offsetY: number;
};

type ViewHub = {
  sessionId: string;
  subscribers: Map<number, ViewSubscriber>;
  cdpSession: any | null;
  geometry: FrameGeometry | null;
  stopTimer: NodeJS.Timeout | null;
  metadataTimer: NodeJS.Timeout | null;
  captureTimer: NodeJS.Timeout | null;
  lastFrameKey: string | null;
  idleFrames: number;
  destroyed: boolean;
};

type ViewSubscriber = {
  subscriptionId: number;
  sessionId: string;
  ws: WebSocket;
  /** Fixed 5-byte binary frame header carrying this subscriber's id, so stale frames can be dropped client-side after a session switch. */
  frameHeader: Buffer;
  /** Token bucket shared with the dispatcher, limiting injected input events. */
  inputBucket: TokenBucket;
  framePacer: FramePacer;
  sentFrames: number;
  droppedFrames: number;
};

/** Alias for the conflating pacer factory's instance, used by subscriber records. */
type FramePacer = ReturnType<typeof createFramePacer>;
/** Alias for the token bucket factory's instance, used by subscriber and connection records. */
type TokenBucket = ReturnType<typeof createTokenBucket>;

/** Parses an integer env override into a clamped value with a default, so a malformed setting can never disable streaming or blow up resource use. */
function clampInt(raw: string | undefined, min: number, max: number, fallback: number): number {
  const parsed = Number.parseInt(raw || '', 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, parsed));
}

type PacerScheduler = {
  now: () => number;
  setTimeout: (callback: () => void, delayMs: number) => unknown;
  clearTimeout: (handle: unknown) => void;
};

const defaultScheduler: PacerScheduler = {
  now: () => Date.now(),
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
};

/**
 * Conflating frame pacer used by every browser-view subscriber: a frame that
 * arrives before the rate interval elapses replaces any earlier pending frame
 * and is flushed by a single timer, so at most one frame is ever queued and
 * viewers always receive the freshest state. Exported for the module's unit
 * tests, which drive it with an injected scheduler.
 */
export function createFramePacer(minIntervalMs: number, scheduler: PacerScheduler = defaultScheduler) {
  let lastSentAt = -Infinity;
  let pendingFrame: CapturedFrame | null = null;
  let flushHandle: unknown = null;

  const clearFlush = () => {
    if (flushHandle !== null) {
      scheduler.clearTimeout(flushHandle);
      flushHandle = null;
    }
  };

  let onSend: (frame: CapturedFrame) => void = () => {};

  const flush = () => {
    flushHandle = null;
    if (!pendingFrame) {
      return;
    }
    const frame = pendingFrame;
    pendingFrame = null;
    lastSentAt = scheduler.now();
    onSend(frame);
  };

  return {
    /** Registers the sink invoked for frames the pacer decides to emit, in order, at most once per interval. */
    bind(sink: (frame: CapturedFrame) => void) {
      onSend = sink;
    },
    /** Offers a frame; it is either emitted immediately, deferred as the single pending frame, or dropped in favor of a newer one. */
    offer(frame: CapturedFrame) {
      const elapsed = scheduler.now() - lastSentAt;
      if (elapsed >= minIntervalMs) {
        clearFlush();
        pendingFrame = null;
        lastSentAt = scheduler.now();
        onSend(frame);
        return;
      }

      pendingFrame = frame;
      if (flushHandle === null) {
        flushHandle = scheduler.setTimeout(flush, minIntervalMs - elapsed);
      }
    },
    /** Drops any deferred frame without emitting it, e.g. when the subscriber goes away. */
    reset() {
      pendingFrame = null;
      clearFlush();
    },
  };
}

type TokenBucketScheduler = { now: () => number };
const defaultBucketScheduler: TokenBucketScheduler = { now: () => Date.now() };

/**
 * Refill-per-second token bucket capping injected input events. Exported for
 * the module's unit tests, which verify the burst and sustained rates.
 */
export function createTokenBucket(
  capacity: number,
  refillPerSecond: number,
  scheduler: TokenBucketScheduler = defaultBucketScheduler,
) {
  let tokens = capacity;
  let lastRefillAt = scheduler.now();

  return {
    /** Attempts to consume one token; returns false when the caller is rate-limited. */
    take(): boolean {
      const now = scheduler.now();
      const elapsedSeconds = (now - lastRefillAt) / 1000;
      if (elapsedSeconds > 0) {
        tokens = Math.min(capacity, tokens + elapsedSeconds * refillPerSecond);
        lastRefillAt = now;
      }
      if (tokens < 1) {
        return false;
      }
      tokens -= 1;
      return true;
    },
  };
}

const CDP_MODIFIER_BITS: Record<string, number> = { alt: 1, ctrl: 2, meta: 4, shift: 8 };

/** Virtual key codes for named keys, matching the DOM `key` values the panel forwards. */
const KEY_CODE_MAP: Record<string, number> = {
  Backspace: 8, Tab: 9, Enter: 13, Shift: 16, Control: 17, Alt: 18, Pause: 19, CapsLock: 20,
  Escape: 27, Space: 32, PageUp: 33, PageDown: 34, End: 35, Home: 36,
  ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40,
  Insert: 45, Delete: 46,
  Meta: 91, ContextMenu: 93,
  F1: 112, F2: 113, F3: 114, F4: 115, F5: 116, F6: 117, F7: 118, F8: 119, F9: 120, F10: 121, F11: 122, F12: 123,
  NumLock: 144, ScrollLock: 145,
};

function cdpModifiers(modifiers?: InputModifiers): number {
  let bits = 0;
  for (const modifier of modifiers || []) {
    bits |= CDP_MODIFIER_BITS[modifier] || 0;
  }
  return bits;
}

function keyCodeFor(event: { key: string; code?: string }): number {
  const named = KEY_CODE_MAP[event.key];
  if (named !== undefined) {
    return named;
  }
  if (event.key.length === 1) {
    return event.key.toUpperCase().charCodeAt(0);
  }
  // e.g. 'a' handled above; unknown long names fall back to 0, which Chromium accepts for raw keys.
  return 0;
}

/** True for keys that produce text when pressed, which CDP expects as `keyDown` rather than `rawKeyDown`. */
function isPrintableKey(key: string): boolean {
  return key.length === 1;
}

/** Maps a normalized client key event onto a CDP Input.dispatchKeyEvent parameter object. */
function keyEventToCdpParams(event: Extract<BrowserViewInputEvent, { kind: 'key' }>): Record<string, unknown> {
  const modifiers = cdpModifiers(event.modifiers);
  const common = {
    key: event.key,
    code: event.code || '',
    windowsVirtualKeyCode: keyCodeFor(event),
    nativeVirtualKeyCode: keyCodeFor(event),
    modifiers,
    location: event.location || 0,
  };

  if (event.action === 'up') {
    return { type: 'keyUp', ...common };
  }
  if (isPrintableKey(event.key) && event.text !== undefined) {
    return { type: 'keyDown', text: event.text, unmodifiedText: event.text, ...common };
  }
  return { type: 'rawKeyDown', ...common };
}

/**
 * Validates and translates a client input event into CDP dispatch calls. Pure
 * mapping (no CDP traffic) so the module's unit tests can verify every field
 * without a browser. Coordinates arrive normalized to the captured frame and
 * are converted to viewport CSS pixels using the hub's latest screencast
 * geometry.
 */
export function planInputDispatch(
  event: BrowserViewInputEvent,
  geometry: FrameGeometry | null,
): Array<{ method: 'Input.dispatchMouseEvent' | 'Input.dispatchKeyEvent' | 'Input.insertText'; params: Record<string, unknown> }> {
  if (event.kind === 'text') {
    return [{ method: 'Input.insertText', params: { text: event.text.slice(0, 2_000) } }];
  }

  if (event.kind === 'key') {
    return [{ method: 'Input.dispatchKeyEvent', params: keyEventToCdpParams(event) }];
  }

  const scale = geometry && geometry.deviceWidth > 0 && geometry.deviceHeight > 0
    ? geometry
    : { pageScaleFactor: 1, deviceWidth: MAX_FRAME_WIDTH, deviceHeight: MAX_FRAME_HEIGHT, offsetX: 0, offsetY: 0 };
  // Screencast geometry with default automation settings: pageScaleFactor 1 and
  // offset 0, so normalized frame coordinates map linearly onto the CSS
  // viewport. Pinch-zoomed pages fall back to the same linear mapping.
  const pageScale = scale.pageScaleFactor > 0 ? scale.pageScaleFactor : 1;
  const toCss = (point: FramePoint) => ({
    x: Math.max(0, scale.offsetX + (point.u * scale.deviceWidth) / pageScale),
    y: Math.max(0, scale.offsetY + (point.v * scale.deviceHeight) / pageScale),
  });

  if (event.kind === 'wheel') {
    if (!hasFramePoint(event)) {
      return [];
    }
    const position = toCss(event);
    return [{
      method: 'Input.dispatchMouseEvent',
      params: {
        type: 'mouseWheel',
        ...position,
        deltaX: clampNumber(event.deltaX, -10_000, 10_000),
        deltaY: clampNumber(event.deltaY, -10_000, 10_000),
        modifiers: cdpModifiers(event.modifiers),
      },
    }];
  }

  if (!hasFramePoint(event)) {
    return [];
  }
  const position = toCss(event);
  if (event.action === 'move') {
    return [{
      method: 'Input.dispatchMouseEvent',
      params: { type: 'mouseMoved', ...position, button: 'none', modifiers: cdpModifiers(event.modifiers) },
    }];
  }

  return [{
    method: 'Input.dispatchMouseEvent',
    params: {
      type: event.action === 'down' ? 'mousePressed' : 'mouseReleased',
      ...position,
      button: event.button,
      buttons: event.action === 'down' ? buttonBit(event.button) : 0,
      clickCount: clampInt(String(event.clickCount ?? 1), 1, 3, 1),
      modifiers: cdpModifiers(event.modifiers),
    },
  }];
}

function buttonBit(button: string): number {
  if (button === 'right') return 2;
  if (button === 'middle') return 4;
  return 1;
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(min, Math.min(max, value));
}

/** Runtime check for normalized coordinates that preserves the input event's type for the caller. */
function hasFramePoint<T extends { u: unknown; v: unknown }>(value: T): boolean {
  return typeof value.u === 'number' && typeof value.v === 'number'
    && value.u >= 0 && value.u <= 1 && value.v >= 0 && value.v <= 1;
}

const INPUT_BUTTONS = new Set(['left', 'right', 'middle']);
const INPUT_MODIFIERS = new Set(['alt', 'ctrl', 'meta', 'shift']);

function parseModifiers(value: unknown): InputModifiers | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const modifiers = value.filter((entry): entry is string => typeof entry === 'string' && INPUT_MODIFIERS.has(entry));
  return modifiers as InputModifiers;
}

/**
 * Runtime validation for client input events: unknown kinds, out-of-range
 * coordinates, oversized text, and unexpected field types are rejected before
 * anything reaches CDP. Returns null for invalid input.
 */
export function parseBrowserViewInputEvent(raw: unknown): BrowserViewInputEvent | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const event = raw as Record<string, unknown>;
  const modifiers = parseModifiers(event.modifiers);

  if (event.kind === 'text') {
    if (typeof event.text !== 'string' || event.text.length === 0 || event.text.length > 2_000) {
      return null;
    }
    return { kind: 'text', text: event.text };
  }

  if (event.kind === 'key') {
    if (event.action !== 'down' && event.action !== 'up') {
      return null;
    }
    if (typeof event.key !== 'string' || event.key.length === 0 || event.key.length > 32) {
      return null;
    }
    if (event.text !== undefined && (typeof event.text !== 'string' || event.text.length > 8)) {
      return null;
    }
    return {
      kind: 'key',
      action: event.action,
      key: event.key,
      code: typeof event.code === 'string' ? event.code.slice(0, 32) : undefined,
      text: typeof event.text === 'string' ? event.text : undefined,
      repeat: event.repeat === true,
      location: typeof event.location === 'number' ? clampInt(String(event.location), 0, 3, 0) : undefined,
      modifiers,
    };
  }

  if (event.kind === 'wheel') {
    const { deltaX, deltaY } = event as Record<string, unknown> as { deltaX: unknown; deltaY: unknown };
    const point = normalizedPoint(event.u, event.v);
    if (!point || typeof deltaX !== 'number' || typeof deltaY !== 'number') {
      return null;
    }
    return {
      kind: 'wheel',
      u: point.u,
      v: point.v,
      deltaX: clampNumber(deltaX, -10_000, 10_000),
      deltaY: clampNumber(deltaY, -10_000, 10_000),
      modifiers,
    };
  }

  if (event.kind === 'mouse') {
    if (event.action !== 'move' && event.action !== 'down' && event.action !== 'up') {
      return null;
    }
    const point = normalizedPoint(event.u, event.v);
    if (!point || typeof event.button !== 'string' || !INPUT_BUTTONS.has(event.button)) {
      return null;
    }
    return {
      kind: 'mouse',
      action: event.action,
      u: point.u,
      v: point.v,
      button: event.button as 'left' | 'right' | 'middle',
      clickCount: typeof event.clickCount === 'number' ? clampInt(String(event.clickCount), 1, 3, 1) : undefined,
      modifiers,
    };
  }

  return null;
}

/** Validates and returns a coordinate pair in normalized [0, 1] frame space, or null when out of range. */
function normalizedPoint(u: unknown, v: unknown): { u: number; v: number } | null {
  if (typeof u !== 'number' || typeof v !== 'number') {
    return null;
  }
  if (!Number.isFinite(u) || !Number.isFinite(v) || u < 0 || u > 1 || v < 0 || v > 1) {
    return null;
  }
  return { u, v };
}

const hubs = new Map<string, ViewHub>();
const subscribersBySubscriptionId = new Map<number, ViewSubscriber>();
let nextSubscriptionId = randomInt(1, 0xfffffff);

function makeFrameHeader(subscriptionId: number): Buffer {
  // 0xcf marks a binary view frame; the uint32 lets clients discard frames from
  // a subscription they have already switched away from.
  const header = Buffer.allocUnsafe(5);
  header[0] = 0xcf;
  header.writeUInt32LE(subscriptionId, 1);
  return header;
}

function sendJson(subscriber: ViewSubscriber, message: Record<string, unknown>): void {
  if (subscriber.ws.readyState !== subscriber.ws.OPEN) {
    return;
  }
  try {
    subscriber.ws.send(JSON.stringify(message));
  } catch {
    // A failing socket is cleaned up by its close handler; nothing to do here.
  }
}

function frameSubscriber(subscriber: ViewSubscriber, frame: CapturedFrame): void {
  if (subscriber.ws.readyState !== subscriber.ws.OPEN) {
    return;
  }
  // Backpressure guard: a slow viewer must not accumulate unbounded buffers.
  if (subscriber.ws.bufferedAmount > 2 * 1024 * 1024) {
    subscriber.droppedFrames += 1;
    return;
  }
  try {
    subscriber.ws.send(Buffer.concat([subscriber.frameHeader, frame.jpeg]));
    subscriber.sentFrames += 1;
  } catch {
    subscriber.droppedFrames += 1;
  }
}

function stopMetadataTimer(hub: ViewHub): void {
  if (hub.metadataTimer) {
    clearInterval(hub.metadataTimer as NodeJS.Timeout);
    hub.metadataTimer = null;
  }
}

function stopCaptureLoop(hub: ViewHub): void {
  if (hub.captureTimer) {
    clearTimeout(hub.captureTimer as NodeJS.Timeout);
    hub.captureTimer = null;
  }
}

/**
 * One capture pull. Deliberately uses CDP `Page.captureScreenshot` instead of
 * `Page.startScreencast`: screencast delivery is coupled to Chromium's
 * compositor frame scheduling and its ack window, which stalls when the host
 * process's event loop has latency spikes; captureScreenshot composites a
 * fresh frame on demand, so the delivered frame rate degrades gracefully
 * instead of starving. Identical consecutive frames back the loop off toward
 * IDLE_INTERVAL_MS so quiet pages stop paying full-rate capture cost.
 */
async function captureOnce(hub: ViewHub): Promise<void> {
  if (hub.destroyed || !hub.cdpSession || hub.subscribers.size === 0) {
    return;
  }

  const interval = await captureAndFanout(hub).catch(() => CAPTURE_INTERVAL_MS);
  if (hub.destroyed || !hub.cdpSession) {
    return;
  }
  hub.captureTimer = setTimeout(() => {
    hub.captureTimer = null;
    void captureOnce(hub);
  }, interval);
  (hub.captureTimer as NodeJS.Timeout).unref?.();
}

async function captureAndFanout(hub: ViewHub): Promise<number> {
  const result = await hub.cdpSession.send('Page.captureScreenshot', {
    format: 'jpeg',
    quality: JPEG_QUALITY,
    maxWidth: MAX_FRAME_WIDTH,
    maxHeight: MAX_FRAME_HEIGHT,
  });
  const base64 = result && typeof result.data === 'string' ? result.data : null;
  if (!base64) {
    return CAPTURE_INTERVAL_MS;
  }

  const frameKey = base64;
  if (frameKey === hub.lastFrameKey) {
    hub.idleFrames += 1;
  } else {
    hub.idleFrames = 0;
    hub.lastFrameKey = frameKey;
    const frame: CapturedFrame = { jpeg: Buffer.from(base64, 'base64') };
    for (const subscriber of hub.subscribers.values()) {
      subscriber.framePacer.offer(frame);
    }
  }

  return hub.idleFrames >= IDLE_FRAMES_THRESHOLD ? IDLE_INTERVAL_MS : CAPTURE_INTERVAL_MS;
}

function scheduleStopDebounce(hub: ViewHub): void {
  if (hub.stopTimer || hub.destroyed) {
    return;
  }
  if (STOP_DEBOUNCE_MS === 0) {
    teardownHub(hub, 'idle');
    return;
  }
  hub.stopTimer = setTimeout(() => {
    hub.stopTimer = null;
    if (hub.subscribers.size === 0 && !hub.destroyed) {
      teardownHub(hub, 'idle');
    }
  }, STOP_DEBOUNCE_MS);
  (hub.stopTimer as NodeJS.Timeout).unref?.();
}

async function teardownHub(hub: ViewHub, reason: string): Promise<void> {
  if (hub.destroyed) {
    return;
  }
  hub.destroyed = true;
  if (hub.stopTimer) {
    clearTimeout(hub.stopTimer as NodeJS.Timeout);
    hub.stopTimer = null;
  }
  stopMetadataTimer(hub);
  stopCaptureLoop(hub);
  hub.lastFrameKey = null;
  hub.idleFrames = 0;

  const subscribers = [...hub.subscribers.values()];
  hub.subscribers.clear();
  for (const subscriber of subscribers) {
    subscribersBySubscriptionId.delete(subscriber.subscriptionId);
    subscriber.framePacer.reset();
    sendJson(subscriber, { type: 'view_state', subscriptionId: subscriber.subscriptionId, state: 'stopped', reason });
  }

  const cdpSession = hub.cdpSession;
  hub.cdpSession = null;
  if (hubs.get(hub.sessionId) === hub) {
    hubs.delete(hub.sessionId);
  }
  // Detaching only the CDP session; the agent's browser, context, and pages stay untouched.
  if (cdpSession) {
    await cdpSession.detach?.().catch(() => undefined);
  }
}

async function attachCapture(hub: ViewHub): Promise<void> {
  const target = await browserViewService.resolveStreamTarget(hub.sessionId);
  if (!target) {
    await teardownHub(hub, 'unavailable');
    return;
  }

  // Detach any previous CDP session before attaching to the (possibly different) active page.
  if (hub.cdpSession) {
    const previous = hub.cdpSession;
    hub.cdpSession = null;
    await previous.detach?.().catch(() => undefined);
  }

  const cdpSession = await target.context.newCDPSession(target.page);
  hub.cdpSession = cdpSession;
  hub.lastFrameKey = null;
  hub.idleFrames = 0;
  const viewport = await Promise.resolve(target.page.viewportSize?.() ?? null).catch(() => null);
  // Pull capture has no per-frame metadata; input coordinates map linearly
  // onto the automation viewport, which is fixed and unzoomed.
  hub.geometry = {
    pageScaleFactor: 1,
    deviceWidth: viewport?.width || 1440,
    deviceHeight: viewport?.height || 900,
    offsetX: 0,
    offsetY: 0,
  };

  await cdpSession.send('Page.enable').catch(() => undefined);
  stopCaptureLoop(hub);
  await captureOnce(hub);
}

async function refreshMetadata(hub: ViewHub): Promise<void> {
  if (hub.destroyed || hub.subscribers.size === 0) {
    return;
  }

  const target = await browserViewService.resolveStreamTarget(hub.sessionId).catch(() => null);
  if (!target) {
    await teardownHub(hub, 'stopped');
    return;
  }

  // Read-only metadata refresh: unlike agent actions, viewing must not touch
  // session.updatedAt, so streaming never resets the inactivity expiry.
  const [title, url, viewport] = await Promise.all([
    target.page.title().catch(() => null),
    Promise.resolve().then(() => target.page.url()).catch(() => null),
    Promise.resolve().then(() => target.page.viewportSize?.() ?? null).catch(() => null),
  ]);

  for (const subscriber of hub.subscribers.values()) {
    sendJson(subscriber, {
      type: 'view_meta',
      subscriptionId: subscriber.subscriptionId,
      session: {
        id: target.session.id,
        status: target.session.status,
        url,
        title,
        viewport,
        lastAction: target.session.lastAction,
        cursor: target.session.cursor,
      },
      viewerCount: hub.subscribers.size,
      fps: Math.round((subscriber.sentFrames / (METADATA_INTERVAL_MS / 1000))),
      droppedFrames: subscriber.droppedFrames,
    });
    subscriber.sentFrames = 0;
    subscriber.droppedFrames = 0;
  }
}

async function ensureHubStarted(hub: ViewHub): Promise<void> {
  if (hub.stopTimer) {
    clearTimeout(hub.stopTimer as NodeJS.Timeout);
    hub.stopTimer = null;
  }
  if (!hub.metadataTimer) {
    hub.metadataTimer = setInterval(() => {
      void refreshMetadata(hub);
    }, METADATA_INTERVAL_MS);
    (hub.metadataTimer as NodeJS.Timeout).unref?.();
  }
  if (!hub.cdpSession) {
    await attachCapture(hub);
  }
}

export const browserViewService = {
  /**
   * Resolves the streaming target (session record, context, active page) for a
   * session. Indirected through this method so the module's unit tests can
   * exercise hub lifecycle without a Playwright runtime; production always
   * delegates to browser-use.service's live handles.
   */
  async resolveStreamTarget(sessionId: string) {
    return browserUseService.getAgentStreamTarget(sessionId);
  },

  /**
   * Registers a viewer for a session and starts capture when this is the first
   * subscriber. Resolves with the subscription id, or a code describing why the
   * subscription was refused. Authorization is enforced by the WebSocket
   * handler before this call; the session lookup here remains the single source
   * of truth for existence and readiness.
   */
  async subscribe(sessionId: string, ws: WebSocket): Promise<{ subscriptionId: number } | { error: string; message: string }> {
    const target = await this.resolveStreamTarget(sessionId).catch((error: unknown) => ({ notFound: error }));
    if (!target || 'notFound' in target) {
      return { error: 'session_unavailable', message: 'Browser session not found or not ready.' };
    }

    let hub = hubs.get(sessionId);
    if (hub?.destroyed) {
      hubs.delete(sessionId);
      hub = undefined;
    }
    if (!hub) {
      hub = {
        sessionId,
        subscribers: new Map(),
        cdpSession: null,
        geometry: null,
        stopTimer: null,
        metadataTimer: null,
        captureTimer: null,
        lastFrameKey: null,
        idleFrames: 0,
        destroyed: false,
      };
      hubs.set(sessionId, hub);
    }
    if (hub.subscribers.size >= MAX_SUBSCRIBERS_PER_SESSION) {
      return { error: 'subscriber_limit', message: `This session already has ${MAX_SUBSCRIBERS_PER_SESSION} viewers.` };
    }

    const subscriptionId = nextSubscriptionId;
    nextSubscriptionId = (nextSubscriptionId + 1) % 0xfffffff;

    const subscriber: ViewSubscriber = {
      subscriptionId,
      sessionId,
      ws,
      frameHeader: makeFrameHeader(subscriptionId),
      inputBucket: createTokenBucket(INPUT_EVENTS_PER_SECOND, INPUT_EVENTS_PER_SECOND),
      framePacer: createFramePacer(Math.max(1, Math.round(1000 / MAX_FPS))),
      sentFrames: 0,
      droppedFrames: 0,
    };
    subscriber.framePacer.bind((frame) => frameSubscriber(subscriber, frame));

    hub.subscribers.set(subscriptionId, subscriber);
    subscribersBySubscriptionId.set(subscriptionId, subscriber);

    try {
      await ensureHubStarted(hub);
    } catch (error: any) {
      hub.subscribers.delete(subscriptionId);
      subscribersBySubscriptionId.delete(subscriptionId);
      if (hub.subscribers.size === 0) {
        await teardownHub(hub, 'capture_failed').catch(() => undefined);
      }
      return { error: 'capture_failed', message: error?.message || 'Failed to start browser capture.' };
    }

    sendJson(subscriber, {
      type: 'view_state',
      subscriptionId,
      state: 'live',
      session: {
        id: target.session.id,
        status: target.session.status,
        url: target.session.url,
        title: target.session.title,
        viewport: target.session.viewport,
        lastAction: target.session.lastAction,
        cursor: target.session.cursor,
      },
      viewerCount: hub.subscribers.size,
    });

    return { subscriptionId };
  },

  /** Removes one subscription; capture winds down after a debounce once the last subscriber leaves. */
  unsubscribe(subscriptionId: number): void {
    const subscriber = subscribersBySubscriptionId.get(subscriptionId);
    if (!subscriber) {
      return;
    }
    subscribersBySubscriptionId.delete(subscriptionId);
    subscriber.framePacer.reset();

    const hub = hubs.get(subscriber.sessionId);
    if (!hub) {
      return;
    }
    hub.subscribers.delete(subscriptionId);
    if (hub.subscribers.size === 0) {
      scheduleStopDebounce(hub);
    }
  },

  /** Drops every subscription using a socket, e.g. after its close event. */
  unsubscribeSocket(ws: WebSocket): void {
    for (const [subscriptionId, subscriber] of [...subscribersBySubscriptionId.entries()]) {
      if (subscriber.ws === ws) {
        this.unsubscribe(subscriptionId);
      }
    }
  },

  /**
   * Forwards a validated input event from a viewer into the agent's page via
   * CDP input injection. Rate limiting happens here, per subscription.
   */
  async dispatchInput(subscriptionId: number, rawEvent: unknown): Promise<{ ok: true } | { error: string; message: string }> {
    const subscriber = subscribersBySubscriptionId.get(subscriptionId);
    if (!subscriber) {
      return { error: 'not_subscribed', message: 'No active browser view subscription.' };
    }

    const event = parseBrowserViewInputEvent(rawEvent);
    if (!event) {
      return { error: 'invalid_input', message: 'Unsupported browser view input event.' };
    }

    if (!subscriber.inputBucket.take()) {
      return { error: 'rate_limited', message: 'Browser view input rate limit exceeded.' };
    }

    const hub = hubs.get(subscriber.sessionId);
    if (!hub || hub.destroyed || !hub.cdpSession) {
      return { error: 'not_live', message: 'Browser view is not live.' };
    }

    for (const call of planInputDispatch(event, hub.geometry)) {
      await hub.cdpSession.send(call.method, call.params).catch(() => undefined);
    }
    return { ok: true };
  },

  /**
   * Called by browser-use.service after tab operations replace the active page:
   * reattaches capture to the new page and keeps current subscribers.
   */
  async handleActivePageChanged(sessionId: string): Promise<void> {
    const hub = hubs.get(sessionId);
    if (!hub || hub.destroyed) {
      return;
    }
    if (hub.subscribers.size === 0) {
      // Nothing to stream; drop the old capture so the next subscriber starts clean.
      await teardownHub(hub, 'idle').catch(() => undefined);
      return;
    }
    try {
      await attachCapture(hub);
      for (const subscriber of hub.subscribers.values()) {
        sendJson(subscriber, { type: 'view_state', subscriptionId: subscriber.subscriptionId, state: 'live', viewerCount: hub.subscribers.size, pageChanged: true });
      }
    } catch {
      await teardownHub(hub, 'capture_failed').catch(() => undefined);
    }
  },

  /**
   * Called by browser-use.service when a session's browser closes (stop,
   * delete, expiry, shutdown): notifies viewers and releases capture.
   */
  async handleSessionClosed(sessionId: string, reason = 'stopped'): Promise<void> {
    const hub = hubs.get(sessionId);
    if (hub) {
      await teardownHub(hub, reason).catch(() => undefined);
    }
  },

  /** Tears down every hub; used on server shutdown alongside stopAllSessions. */
  async stopAll(): Promise<void> {
    await Promise.all([...hubs.values()].map((hub) => teardownHub(hub, 'shutdown').catch(() => undefined)));
  },

  /** Current active viewer count for a session, used by tests and diagnostics. */
  viewerCount(sessionId: string): number {
    return hubs.get(sessionId)?.subscribers.size ?? 0;
  },

  /** True when capture is currently attached for a session, used by tests. */
  isCapturing(sessionId: string): boolean {
    const hub = hubs.get(sessionId);
    return Boolean(hub && !hub.destroyed && hub.cdpSession);
  },
};

process.once('beforeExit', () => {
  void browserViewService.stopAll();
});
