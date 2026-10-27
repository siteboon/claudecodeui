import assert from 'node:assert/strict';
import test from 'node:test';

// Must be set before the module under test loads: the stop debounce is read
// once at import time and the lifecycle tests need it short.
process.env.CLOUDCLI_BROWSER_VIEW_STOP_DEBOUNCE_MS = '40';

const {
  createFramePacer,
  createTokenBucket,
  parseBrowserViewInputEvent,
  planInputDispatch,
  browserViewService,
} = await import('@/modules/browser-use/browser-view.service.js');

type FakeScheduler = {
  now: () => number;
  setTimeout: (callback: () => void, delayMs: number) => unknown;
  clearTimeout: (handle: unknown) => void;
};

function makeScheduler(startAt = 0): FakeScheduler & { advance: (ms: number) => void } {
  let currentTime = startAt;
  const timers: Array<{ callback: () => void; dueAt: number; cancelled: boolean }> = [];
  return {
    now: () => currentTime,
    setTimeout: (callback, delayMs) => {
      const timer = { callback, dueAt: currentTime + delayMs, cancelled: false };
      timers.push(timer);
      return timer;
    },
    clearTimeout: (timer) => {
      (timer as { cancelled: boolean }).cancelled = true;
    },
    advance: (ms: number) => {
      const target = currentTime + ms;
      for (;;) {
        const due = timers.filter((timer) => !timer.cancelled && timer.dueAt <= target)
          .sort((a, b) => a.dueAt - b.dueAt)[0];
        if (!due) {
          break;
        }
        currentTime = due.dueAt;
        due.cancelled = true;
        due.callback();
      }
      currentTime = target;
    },
  };
}

test('frame pacer emits immediately, conflates early frames, and flushes the newest', () => {
  const scheduler = makeScheduler();
  const pacer = createFramePacer(100, scheduler);
  const sent: number[] = [];
  pacer.bind((frame) => sent.push(frame.jpeg as unknown as number));

  pacer.offer({ jpeg: 1 as unknown as Buffer });
  assert.deepEqual(sent, [1]);

  scheduler.advance(10);
  pacer.offer({ jpeg: 2 as unknown as Buffer });
  assert.deepEqual(sent, [1], 'frame arriving early must not emit');

  scheduler.advance(20);
  pacer.offer({ jpeg: 3 as unknown as Buffer });
  assert.deepEqual(sent, [1], 'second early frame replaces the pending one');

  scheduler.advance(200);
  assert.deepEqual(sent, [1, 3], 'flush delivers only the newest conflated frame');

  scheduler.advance(100);
  pacer.offer({ jpeg: 4 as unknown as Buffer });
  assert.deepEqual(sent, [1, 3, 4], 'interval elapsed emits again immediately');
});

test('frame pacer reset drops pending frames', () => {
  const scheduler = makeScheduler();
  const pacer = createFramePacer(100, scheduler);
  const sent: number[] = [];
  pacer.bind((frame) => sent.push(frame.jpeg as unknown as number));

  pacer.offer({ jpeg: 1 as unknown as Buffer });
  scheduler.advance(1);
  pacer.offer({ jpeg: 2 as unknown as Buffer });
  pacer.reset();
  scheduler.advance(500);

  assert.deepEqual(sent, [1]);
});

test('token bucket allows bursts up to capacity then sustains the refill rate', () => {
  let now = 0;
  const bucket = createTokenBucket(3, 10, { now: () => now });

  assert.equal(bucket.take(), true);
  assert.equal(bucket.take(), true);
  assert.equal(bucket.take(), true);
  assert.equal(bucket.take(), false, 'burst capacity exhausted');

  now = 100;
  assert.equal(bucket.take(), true, 'a tenth of a second refills exactly one token at ten per second');
  assert.equal(bucket.take(), false, 'refill does not exceed the consumption rate');

  now = 500;
  assert.equal(bucket.take(), true);
  assert.equal(bucket.take(), true);
  assert.equal(bucket.take(), true);
  assert.equal(bucket.take(), false, 'longer gaps refill up to capacity but never beyond it');
});

type InputEventTestCase = {
  name: string;
  raw: unknown;
  valid: boolean;
};

const INPUT_EVENT_CASES: InputEventTestCase[] = [
  { name: 'valid mouse click', raw: { kind: 'mouse', action: 'down', u: 0.5, v: 0.5, button: 'left', clickCount: 1 }, valid: true },
  { name: 'mouse with out-of-range u', raw: { kind: 'mouse', action: 'down', u: 1.5, v: 0.5, button: 'left' }, valid: false },
  { name: 'mouse with unknown button', raw: { kind: 'mouse', action: 'down', u: 0.1, v: 0.1, button: 'side' }, valid: false },
  { name: 'valid wheel', raw: { kind: 'wheel', u: 0.2, v: 0.8, deltaX: 0, deltaY: -120 }, valid: true },
  { name: 'wheel missing deltaY', raw: { kind: 'wheel', u: 0.2, v: 0.8, deltaX: 0 }, valid: false },
  { name: 'valid key down', raw: { kind: 'key', action: 'down', key: 'a', code: 'KeyA', text: 'a' }, valid: true },
  { name: 'key with empty key', raw: { kind: 'key', action: 'down', key: '' }, valid: false },
  { name: 'valid text insert', raw: { kind: 'text', text: 'hunter2' }, valid: true },
  { name: 'oversized text insert', raw: { kind: 'text', text: 'x'.repeat(2001) }, valid: false },
  { name: 'unknown kind', raw: { kind: 'gamepad', button: 'a' }, valid: false },
  { name: 'non-object', raw: 'click', valid: false },
];

for (const testCase of INPUT_EVENT_CASES) {
  test(`input event validation: ${testCase.name}`, () => {
    assert.equal(parseBrowserViewInputEvent(testCase.raw) !== null, testCase.valid);
  });
}

test('planInputDispatch maps normalized coordinates onto the CSS viewport', () => {
  const geometry = { pageScaleFactor: 1, deviceWidth: 1440, deviceHeight: 900, offsetX: 0, offsetY: 0 };
  const calls = planInputDispatch(
    { kind: 'mouse', action: 'down', u: 0.5, v: 0.25, button: 'left', clickCount: 1 },
    geometry,
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'Input.dispatchMouseEvent');
  assert.equal(calls[0].params.type, 'mousePressed');
  assert.equal(calls[0].params.x, 720);
  assert.equal(calls[0].params.y, 225);
  assert.equal(calls[0].params.button, 'left');
});

test('planInputDispatch falls back to linear mapping without geometry', () => {
  const calls = planInputDispatch(
    { kind: 'mouse', action: 'move', u: 1, v: 0, button: 'left' },
    null,
  );

  assert.equal(calls[0].params.type, 'mouseMoved');
  assert.ok((calls[0].params.x as number) > 0);
});

test('planInputDispatch maps keys with modifiers and printable text', () => {
  const geometry = null;
  const down = planInputDispatch(
    { kind: 'key', action: 'down', key: 'c', code: 'KeyC', text: 'c', modifiers: ['ctrl'] },
    geometry,
  )[0];

  assert.equal(down.method, 'Input.dispatchKeyEvent');
  assert.equal(down.params.type, 'keyDown');
  assert.equal(down.params.text, 'c');
  assert.equal(down.params.modifiers, 2);
  assert.equal(down.params.windowsVirtualKeyCode, 67);

  const enterDown = planInputDispatch({ kind: 'key', action: 'down', key: 'Enter', code: 'Enter' }, geometry)[0];
  assert.equal(enterDown.params.type, 'rawKeyDown');
  assert.equal(enterDown.params.windowsVirtualKeyCode, 13);

  const up = planInputDispatch({ kind: 'key', action: 'up', key: 'Enter', code: 'Enter' }, geometry)[0];
  assert.equal(up.params.type, 'keyUp');
});

test('planInputDispatch maps wheel and paste events', () => {
  const wheel = planInputDispatch({ kind: 'wheel', u: 0.5, v: 0.5, deltaX: 0, deltaY: -240 }, null)[0];
  assert.equal(wheel.method, 'Input.dispatchMouseEvent');
  assert.equal(wheel.params.type, 'mouseWheel');
  assert.equal(wheel.params.deltaY, -240);

  const paste = planInputDispatch({ kind: 'text', text: 'pasted-secret' }, null)[0];
  assert.equal(paste.method, 'Input.insertText');
  assert.equal(paste.params.text, 'pasted-secret');
});

// ---------------------------------------------------------------------------
// Hub lifecycle through the service, with stream targets stubbed out.

type FakeCdp = {
  sent: Array<{ method: string; params: any }>;
  handlers: Map<string, (payload: any) => void>;
  detached: boolean;
  /** Base64 payloads returned one per Page.captureScreenshot pull; the last entry repeats. */
  screenshotQueue: string[];
  pulls: number;
  send: (method: string, params?: any) => Promise<any>;
  on: (event: string, handler: (payload: any) => void) => void;
  detach: () => Promise<void>;
};

function makeFakeCdp(): FakeCdp {
  const sent: FakeCdp['sent'] = [];
  const handlers = new Map<string, (payload: any) => void>();
  const cdp: FakeCdp = {
    sent,
    handlers,
    detached: false,
    screenshotQueue: [],
    pulls: 0,
    send: async (method, params = {}) => {
      sent.push({ method, params });
      if (method === 'Page.captureScreenshot') {
        cdp.pulls += 1;
        const data = cdp.screenshotQueue.length > 1
          ? cdp.screenshotQueue.shift()
          : cdp.screenshotQueue[0] || Buffer.from('frame').toString('base64');
        return { data };
      }
      return {};
    },
    on: (event, handler) => {
      handlers.set(event, handler);
    },
    detach: async () => {},
  };
  return cdp;
}

type FakeTarget = {
  session: Record<string, unknown>;
  context: { newCDPSession: () => Promise<FakeCdp> };
  page: Record<string, unknown>;
};

type FakeWebSocket = {
  readyState: string;
  OPEN: string;
  bufferedAmount: number;
  sent: Array<{ kind: 'json'; data: any } | { kind: 'binary'; data: Buffer }>;
  send: (data: string | Buffer) => void;
};

function makeFakeWebSocket(): FakeWebSocket {
  const ws: FakeWebSocket = {
    readyState: 'open',
    OPEN: 'open',
    bufferedAmount: 0,
    sent: [],
    send: (data) => {
      ws.sent.push(typeof data === 'string'
        ? { kind: 'json', data: JSON.parse(data) }
        : { kind: 'binary', data });
    },
  };
  return ws;
}

// Each lifecycle test uses its own session id so a failed test cannot leak hub
// state into the next one; hubs are keyed by session id inside the service.
let sessionCounter = 0;
const nextSessionId = () => `test-session-${sessionCounter += 1}`;

/** Swaps the service's stream-target resolution for a stub while the callback runs. */
async function withStubbedTarget(target: FakeTarget | null, run: () => Promise<void>): Promise<void> {
  const service: any = browserViewService;
  const original = service.resolveStreamTarget;
  service.resolveStreamTarget = async () => target;
  try {
    await run();
  } finally {
    service.resolveStreamTarget = original;
  }
}

test('subscribe starts pull capture and delivers fresh frames', async () => {
  const sessionId = nextSessionId();
  const cdp = makeFakeCdp();
  const page = { fake: 'page' };
  const target: FakeTarget = {
    session: { id: sessionId, status: 'ready', url: 'https://example.test', title: 'Example', viewport: { width: 1440, height: 900 }, lastAction: null, cursor: null },
    context: { newCDPSession: async () => cdp },
    page,
  };

  await withStubbedTarget(target, async () => {
    const ws = makeFakeWebSocket();
    const result = await browserViewService.subscribe(sessionId, ws as any);
    assert.ok('subscriptionId' in result, 'subscribe must resolve with a subscription');
    const subscriptionId = (result as { subscriptionId: number }).subscriptionId;

    try {
      assert.ok(browserViewService.isCapturing(sessionId));
      const liveState = ws.sent.find((entry) => entry.kind === 'json' && entry.data.type === 'view_state');
      assert.equal(liveState?.data.state, 'live');

      // Distinct payloads stream through the capture pulls at the paced rate.
      cdp.screenshotQueue = ['a', 'b', 'c', 'd', 'e'].map((marker) => Buffer.from(marker).toString('base64'));
      await new Promise((resolve) => setTimeout(resolve, 350));

      const binaryFrames = ws.sent.filter((entry) => entry.kind === 'binary') as Array<{ kind: 'binary'; data: Buffer }>;
      assert.ok(binaryFrames.length >= 2, `expected multiple delivered frames, got ${binaryFrames.length}`);
      assert.ok(cdp.sent.some((call) => call.method === 'Page.captureScreenshot'), 'capture must pull screenshots');
      assert.ok(cdp.pulls >= 2, `expected repeated capture pulls, got ${cdp.pulls}`);
    } finally {
      browserViewService.unsubscribe(subscriptionId);
    }
  });
});

test('identical consecutive frames back the capture loop off and stop delivering', async () => {
  const sessionId = nextSessionId();
  const cdp = makeFakeCdp();
  const target: FakeTarget = {
    session: { id: sessionId, status: 'ready' },
    context: { newCDPSession: async () => cdp },
    page: {},
  };

  await withStubbedTarget(target, async () => {
    // One static frame repeated forever: only the first capture delivers.
    cdp.screenshotQueue = [Buffer.from('static').toString('base64')];
    const ws = makeFakeWebSocket();
    const result = await browserViewService.subscribe(sessionId, ws as any);
    const subscriptionId = (result as { subscriptionId: number }).subscriptionId;

    try {
      await new Promise((resolve) => setTimeout(resolve, 400));
      const binaryFrames = ws.sent.filter((entry) => entry.kind === 'binary') as Array<{ kind: 'binary'; data: Buffer }>;
      assert.equal(binaryFrames.length, 1, 'an idle page must not keep streaming frames');

      // A change on the page resumes delivery immediately.
      cdp.screenshotQueue = [Buffer.from('changed').toString('base64')];
      await new Promise((resolve) => setTimeout(resolve, 650));
      const afterChange = ws.sent.filter((entry) => entry.kind === 'binary') as Array<{ kind: 'binary'; data: Buffer }>;
      assert.equal(afterChange.length, 2, 'a fresh frame delivers after the idle interval');
    } finally {
      browserViewService.unsubscribe(subscriptionId);
    }
  });
});

test('last unsubscribe tears capture down after the debounce without touching the browser', async () => {
  const sessionId = nextSessionId();
  const cdp = makeFakeCdp();
  const target: FakeTarget = {
    session: { id: sessionId, status: 'ready' },
    context: { newCDPSession: async () => cdp },
    page: {},
  };

  await withStubbedTarget(target, async () => {
    const ws = makeFakeWebSocket();
    const result = await browserViewService.subscribe(sessionId, ws as any);
    assert.ok('subscriptionId' in result);
    const subscriptionId = (result as { subscriptionId: number }).subscriptionId;

    try {
      assert.ok(browserViewService.isCapturing(sessionId));

      browserViewService.unsubscribe(subscriptionId);
      assert.ok(browserViewService.isCapturing(sessionId), 'capture survives the debounce window');

      await new Promise((resolve) => setTimeout(resolve, 120));
      assert.equal(browserViewService.isCapturing(sessionId), false, 'capture stops after the debounce');
      assert.equal(browserViewService.viewerCount(sessionId), 0);
    } finally {
      browserViewService.unsubscribe(subscriptionId);
    }
  });
});

test('page change reattaches capture to the new page and keeps subscribers', async () => {
  const sessionId = nextSessionId();
  let cdp = makeFakeCdp();
  const createdCdps: FakeCdp[] = [];
  const target: FakeTarget = {
    session: { id: sessionId, status: 'ready' },
    context: {
      newCDPSession: async () => {
        cdp = makeFakeCdp();
        createdCdps.push(cdp);
        return cdp;
      },
    },
    page: {},
  };

  await withStubbedTarget(target, async () => {
    const ws = makeFakeWebSocket();
    const result = await browserViewService.subscribe(sessionId, ws as any);
    assert.ok('subscriptionId' in result);
    const subscriptionId = (result as { subscriptionId: number }).subscriptionId;

    try {
      await browserViewService.handleActivePageChanged(sessionId);

      assert.equal(createdCdps.length, 2, 'capture reattaches through a new CDP session');
      const changedState = ws.sent
        .filter((entry) => entry.kind === 'json')
        .map((entry) => (entry as { data: any }).data)
        .find((data) => data.type === 'view_state' && data.pageChanged);
      assert.ok(changedState, 'subscribers are told the page changed');
      assert.equal(browserViewService.viewerCount(sessionId), 1);
    } finally {
      browserViewService.unsubscribe(subscriptionId);
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
  });
});

test('session close notifies viewers and releases capture', async () => {
  const sessionId = nextSessionId();
  const cdp = makeFakeCdp();
  const target: FakeTarget = {
    session: { id: sessionId, status: 'ready' },
    context: { newCDPSession: async () => cdp },
    page: {},
  };

  await withStubbedTarget(target, async () => {
    const ws = makeFakeWebSocket();
    const result = await browserViewService.subscribe(sessionId, ws as any);
    assert.ok('subscriptionId' in result);

    await browserViewService.handleSessionClosed(sessionId, 'stopped');

    assert.equal(browserViewService.isCapturing(sessionId), false);
    const stopped = ws.sent
      .filter((entry) => entry.kind === 'json')
      .map((entry) => (entry as { data: any }).data)
      .find((data) => data.type === 'view_state' && data.state === 'stopped');
    assert.ok(stopped, 'viewers receive a stopped state');
    assert.equal(browserViewService.viewerCount(sessionId), 0);
  });
});

test('input dispatch is rate limited per subscription', async () => {
  const sessionId = nextSessionId();
  const cdp = makeFakeCdp();
  const target: FakeTarget = {
    session: { id: sessionId, status: 'ready' },
    context: { newCDPSession: async () => cdp },
    page: {},
  };

  await withStubbedTarget(target, async () => {
    const ws = makeFakeWebSocket();
    const result = await browserViewService.subscribe(sessionId, ws as any);
    const subscriptionId = (result as { subscriptionId: number }).subscriptionId;

    try {
      let accepted = 0;
      let limited = 0;
      for (let index = 0; index < 300; index += 1) {
        const dispatch = await browserViewService.dispatchInput(subscriptionId, {
          kind: 'mouse', action: 'move', u: 0.5, v: 0.5, button: 'left',
        });
        if ('ok' in dispatch) {
          accepted += 1;
        } else {
          limited += 1;
        }
      }

      assert.ok(accepted > 0, 'some events are accepted');
      assert.ok(limited > 0, 'the burst is throttled');
      const mouseMoves = cdp.sent.filter((call) => call.method === 'Input.dispatchMouseEvent');
      assert.equal(mouseMoves.length, accepted, 'only accepted events reach CDP');
    } finally {
      browserViewService.unsubscribe(subscriptionId);
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
  });
});
