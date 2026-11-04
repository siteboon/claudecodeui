import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, onTestFinished, test, vi } from 'vitest';

import type * as LazyRowObserverModule from '@/modules/chat/hooks/useLazyRowObserver';
import type { NormalizedMessage, Project, ProjectSession, SessionActivityMap } from '@/shared/types';

/**
 * The background-tasks strip reveals a task's row by widening the visible
 * window and then scrolling to the row's wrapper. The widened window commits
 * after the current frame, so the first lookup runs before the row exists;
 * settling for the nearest row there scrolled to an unrelated row and ended
 * the retry chain, and the task's row never came into view.
 */

vi.mock('@/shared/api', () => ({
  api: { providers: { sessionTokenUsage: () => Promise.resolve({ ok: false, json: async () => ({}) }) } },
}));

// Which writes the session state hands to the manual scroll anchoring as its
// own; the real note still happens.
const noteProgrammaticScroll = vi.hoisted(() => vi.fn());
vi.mock('@/modules/chat/hooks/useLazyRowObserver', async (importOriginal) => {
  const actual = await importOriginal<typeof LazyRowObserverModule>();
  return {
    ...actual,
    noteProgrammaticScroll: (container: Element) => {
      noteProgrammaticScroll(container);
      actual.noteProgrammaticScroll(container);
    },
  };
});

const project: Project = { projectId: 'project-1', path: '/repo', fullPath: '/repo', displayName: 'Repo', isStarred: false };
const session: ProjectSession = { id: 'session-a', summary: 'A', lastActivity: '2026-01-01T00:00:00.000Z', messageCount: 1 } as ProjectSession;
const slot = { fetchedAt: 1, status: 'idle' as const, total: 0, hasMore: false, offset: 0 };
// What the store's fetchFromServer reports for a request that loaded.
const fetched = (fields: Partial<typeof slot> = {}) => ({ slot: { ...slot, ...fields }, ok: true });
const store = {
  fetchFromServer: vi.fn(async () => fetched()),
  fetchMore: vi.fn(),
  appendRealtime: vi.fn(),
  refreshLatestFromServer: vi.fn(),
  setActiveSession: vi.fn(),
  isStale: vi.fn(() => false),
  updateStreaming: vi.fn(),
  finalizeStreaming: vi.fn(),
  getMessages: vi.fn((): NormalizedMessage[] => []),
  getSessionSlot: vi.fn(() => slot),
};

const PANE_HEIGHT = 600;
const ROW_HEIGHT = 100;

/**
 * A pane 600px tall, `viewportTop` below the top of the page, laid out the way
 * a browser would: each row sits at a place in the content, so its box follows
 * scrollTop, and scrollTop stays within the content. While `hidden` (the Chat
 * tab behind another one) every box is 0x0 and writes do nothing. A write that
 * leaves a row's middle at the pane's middle counts as a jump to that row
 * (`scrolls`).
 */
const createPane = ({ contentHeight = 10_000, top = 0, viewportTop = 0 } = {}) => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let scrollTop = top;
  let height = contentHeight;
  let hidden = false;
  let writes = 0;
  const contentTops = new Map<Element, number>();
  const centred = new Map<Element, number>();
  const box = (boxTop: number, boxHeight: number) => (hidden
    ? { top: 0, bottom: 0, height: 0, width: 0 }
    : { top: boxTop, bottom: boxTop + boxHeight, height: boxHeight, width: 800 }) as DOMRect;
  Object.defineProperty(container, 'clientHeight', { configurable: true, get: () => (hidden ? 0 : PANE_HEIGHT) });
  Object.defineProperty(container, 'scrollHeight', { configurable: true, get: () => height });
  Object.defineProperty(container, 'scrollTop', {
    configurable: true,
    get: () => scrollTop,
    set: (value: number) => {
      writes += 1;
      if (hidden) return;
      scrollTop = Math.max(0, Math.min(value, height - PANE_HEIGHT));
      for (const [element, rowTop] of contentTops) {
        if (Math.abs(rowTop + ROW_HEIGHT / 2 - scrollTop - PANE_HEIGHT / 2) < 0.5) {
          centred.set(element, (centred.get(element) ?? 0) + 1);
        }
      }
    },
  });
  container.getBoundingClientRect = () => box(viewportTop, PANE_HEIGHT);
  const addRow = (timestamp: string, contentTop: number) => {
    const element = document.createElement('div');
    element.setAttribute('data-message-timestamp', timestamp);
    contentTops.set(element, contentTop);
    element.getBoundingClientRect = () => box(viewportTop + contentTops.get(element)! - scrollTop, ROW_HEIGHT);
    container.appendChild(element);
    return element;
  };
  return {
    container,
    addRow,
    moveRow: (element: Element, contentTop: number) => { contentTops.set(element, contentTop); },
    scrolls: (element: Element) => centred.get(element) ?? 0,
    writes: () => writes,
    getTop: () => scrollTop,
    setTop: (value: number) => { scrollTop = value; },
    setContentHeight: (value: number) => { height = value; },
    setHidden: (value: boolean) => { hidden = value; },
  };
};

// Frames run by hand, so a row can be added between two attempts the way a
// React commit adds it.
const frames: FrameRequestCallback[] = [];

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  store.fetchFromServer.mockImplementation(async () => fetched());
  store.refreshLatestFromServer.mockImplementation(async () => ({ slot, deferred: false }));
  store.getMessages.mockImplementation(() => []);
  noteProgrammaticScroll.mockClear();
});

type SessionStateProps = {
  selected: ProjectSession;
  active?: boolean;
  newSessionTrigger?: number;
  externalMessageUpdate?: number;
  processingSessions?: SessionActivityMap;
};

const renderSessionState = async (initial: ProjectSession = session, initialProps: Partial<SessionStateProps> = {}) => {
  const { useChatSessionState } = await import('@/modules/chat/hooks/useChatSessionState');
  return renderHook(({ selected, active, newSessionTrigger, externalMessageUpdate, processingSessions }: SessionStateProps) =>
    useChatSessionState({
      isActive: active ?? true,
      selectedProject: project,
      selectedSession: selected,
      ws: null,
      sendMessage: vi.fn(),
      externalMessageUpdate,
      newSessionTrigger,
      processingSessions,
      resetStreamingState: vi.fn(),
      statusCheckSentAtRef: { current: new Map() },
      lastSeqRef: { current: new Map() },
      sessionStore: store as never,
    }), { initialProps: { ...initialProps, selected: initial } as SessionStateProps });
};

// Hands the hook the pane it scrolls, the way ChatMessagesPane binds its ref.
const attachPane = (hook: Awaited<ReturnType<typeof renderSessionState>>, container: HTMLElement) => {
  (hook.result.current.scrollContainerRef as { current: HTMLDivElement | null }).current = container as HTMLDivElement;
};

afterEach(() => {
  frames.length = 0;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetModules();
  document.body.innerHTML = '';
});

test('revealing a row not yet rendered waits for it instead of scrolling to its neighbour', async () => {
  const hook = await renderSessionState();
  const pane = createPane();
  const neighbour = pane.addRow('2026-08-21T10:32:09.000Z', 1000);
  attachPane(hook, pane.container);
  frames.length = 0;

  await act(async () => {
    hook.result.current.revealMessage({ type: 'assistant', content: '', timestamp: '2026-08-21T10:32:10.000Z' });
  });

  // First attempt: the target row has not been committed yet.
  assert.equal(frames.length, 1);
  await act(async () => { frames.shift()?.(0); });
  assert.equal(pane.writes(), 0, 'the neighbour must not be scrolled to');
  assert.equal(frames.length, 1, 'the chain goes on');

  // The commit lands the row; the next attempt finds it.
  const target = pane.addRow('2026-08-21T10:32:10.000Z', 3000);
  await act(async () => { frames.shift()?.(0); });
  assert.equal(pane.scrolls(target), 1);

  // What is left are the re-centring frames (tested below); the lookup does
  // not go on, and the neighbour is never scrolled to.
  for (let frame = 0; frame < 30 && frames.length > 0; frame++) {
    await act(async () => { frames.shift()?.(0); });
  }
  assert.equal(frames.length, 0);
  assert.equal(pane.scrolls(target), 1);
  assert.equal(pane.scrolls(neighbour), 0);
});

test('the last attempt settles for the nearest row, for a hit collapsed inside a tool group', async () => {
  const hook = await renderSessionState();
  const pane = createPane();
  const group = pane.addRow('2026-08-21T10:32:09.000Z', 1000);
  attachPane(hook, pane.container);
  frames.length = 0;

  await act(async () => {
    hook.result.current.revealMessage({ type: 'assistant', content: '', timestamp: '2026-08-21T10:32:10.000Z' });
  });
  while (frames.length > 0) {
    await act(async () => { frames.shift()?.(0); });
  }
  assert.equal(pane.scrolls(group), 1);
});

test('a jump centres its row by scrolling the pane alone', async () => {
  // scrollIntoView would also scroll every scrollable ancestor, on each of
  // the up to CENTER_SETTLE_FRAMES re-centres.
  // jsdom has none, so a probe is put on the prototype for this test only.
  const scrollIntoView = vi.fn();
  Element.prototype.scrollIntoView = scrollIntoView;
  onTestFinished(() => { delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView; });
  const hook = await renderSessionState();
  const pane = createPane();
  const target = pane.addRow('2026-08-21T10:32:10.000Z', 1500);
  attachPane(hook, pane.container);
  frames.length = 0;

  await act(async () => {
    hook.result.current.revealMessage({ type: 'assistant', content: '', timestamp: '2026-08-21T10:32:10.000Z' });
  });
  await act(async () => { frames.shift()?.(0); });

  // The row's middle (1550) at the pane's middle (300 below its top).
  assert.equal(pane.getTop(), 1250);
  assert.equal(pane.scrolls(target), 1);
  assert.equal(scrollIntoView.mock.calls.length, 0);
});

test('a jump centres its row in a pane that starts below the top of the page', async () => {
  // The pane's middle is measured on the page, like the row's box, so a pane
  // under the app's header still gets the row in its middle.
  const hook = await renderSessionState();
  const pane = createPane({ viewportTop: 80 });
  const target = pane.addRow('2026-08-21T10:32:10.000Z', 1500);
  attachPane(hook, pane.container);
  frames.length = 0;

  await act(async () => {
    hook.result.current.revealMessage({ type: 'assistant', content: '', timestamp: '2026-08-21T10:32:10.000Z' });
  });
  await act(async () => { frames.shift()?.(0); });

  assert.equal(pane.getTop(), 1250);
  assert.equal(pane.scrolls(target), 1);
});

// A revealed row 1500px into the content of an attached pane, which the test
// moves the way rows mounting around it would.
const revealAttachedRow = async () => {
  const hook = await renderSessionState();
  const pane = createPane();
  const target = pane.addRow('2026-08-21T10:32:10.000Z', 1500);
  attachPane(hook, pane.container);
  frames.length = 0;
  await act(async () => {
    hook.result.current.revealMessage({ type: 'assistant', content: '', timestamp: '2026-08-21T10:32:10.000Z' });
  });
  // Frames run until this reveal's lookup has found the row and jumped.
  for (let frame = 0; frame < 30 && pane.scrolls(target) === 0; frame++) {
    await act(async () => { frames.shift()?.(0); });
  }
  const runFrames = async () => {
    for (let frame = 0; frame < 30 && frames.length > 0; frame++) {
      await act(async () => { frames.shift()?.(0); });
    }
  };
  return {
    hook,
    pane,
    container: pane.container,
    scrolls: () => pane.scrolls(target),
    runFrames,
    moveTo: (contentTop: number) => pane.moveRow(target, contentTop),
  };
};

test('a revealed row is centred again when the rows around it settle, then left alone', async () => {
  const { scrolls, runFrames, moveTo } = await revealAttachedRow();
  assert.equal(scrolls(), 1);

  // Rows mounting above it push it down; the next frame centres it again.
  moveTo(1620);
  await act(async () => { frames.shift()?.(0); });
  assert.equal(scrolls(), 2);

  await runFrames();
  assert.equal(frames.length, 0, 'the loop stops once the row holds still');
  assert.equal(scrolls(), 2);
});

// Each kind of input that means the user is scrolling on their own.
const USER_INPUT_EVENTS = ['wheel', 'touchstart', 'pointerdown', 'keydown'];

test.each(USER_INPUT_EVENTS)('re-centring stops as soon as the user scrolls (%s)', async (type) => {
  const { container, scrolls, runFrames, moveTo } = await revealAttachedRow();

  container.dispatchEvent(new Event(type));
  moveTo(1000);
  await runFrames();

  assert.equal(scrolls(), 1);
});

test('a second jump takes over from the first one\'s re-centring', async () => {
  const hook = await renderSessionState();
  const pane = createPane();
  const first = pane.addRow('2026-08-21T10:32:10.000Z', 1500);
  const second = pane.addRow('2026-08-21T10:32:20.000Z', 3000);
  attachPane(hook, pane.container);
  frames.length = 0;

  await act(async () => {
    hook.result.current.revealMessage({ type: 'assistant', content: '', timestamp: '2026-08-21T10:32:10.000Z' });
  });
  await act(async () => { frames.shift()?.(0); });
  assert.equal(pane.scrolls(first), 1);
  await act(async () => {
    hook.result.current.revealMessage({ type: 'assistant', content: '', timestamp: '2026-08-21T10:32:20.000Z' });
  });

  for (let frame = 0; frame < 30 && pane.scrolls(second) === 0; frame++) {
    await act(async () => { frames.shift()?.(0); });
  }
  assert.equal(pane.scrolls(second), 1);

  // The second jump moved the first row away; its old loop must not pull it back.
  pane.moveRow(first, 1000);
  for (let frame = 0; frame < 40 && frames.length > 0; frame++) {
    await act(async () => { frames.shift()?.(0); });
  }
  assert.equal(pane.scrolls(first), 1);
  assert.equal(pane.scrolls(second), 1);
});

test('jumping to the bottom ends the re-centring', async () => {
  const { hook, pane, scrolls, runFrames, moveTo } = await revealAttachedRow();

  // The scroll-to-bottom button and a sent message sit outside the pane.
  act(() => { hook.result.current.scrollToBottom(); });
  moveTo(1000);
  await runFrames();

  assert.equal(scrolls(), 1);
  assert.equal(pane.getTop(), 10_000 - PANE_HEIGHT);
});

test('re-centring ends when the transcript unmounts', async () => {
  const { hook, scrolls, moveTo } = await revealAttachedRow();

  hook.unmount();
  moveTo(2400);
  for (let frame = 0; frame < 30 && frames.length > 0; frame++) frames.shift()?.(0);

  assert.equal(scrolls(), 1);
});

// Copies of useChatSessionState's CENTER_SETTLE_FRAMES (the frames a
// jumped-to row is checked and re-centred for) and CENTER_STABLE_FRAMES (the
// still frames that end the re-centring early). The two tests below assert
// them exactly, so a change to either in the hook fails here instead of
// leaving a stale copy behind.
const CENTER_SETTLE_FRAMES = 20;
const CENTER_STABLE_FRAMES = 3;

test('a row that never settles is re-centred for a bounded number of frames', async () => {
  const { scrolls, moveTo } = await revealAttachedRow();
  let settleFrames = 0;
  for (; settleFrames < 60 && frames.length > 0; settleFrames++) {
    moveTo(1500 + settleFrames * 7 + 7);
    await act(async () => { frames.shift()?.(0); });
  }
  assert.equal(frames.length, 0);
  assert.equal(settleFrames, CENTER_SETTLE_FRAMES);
  // The jump itself, then one re-centre per settle frame.
  assert.equal(scrolls(), 1 + CENTER_SETTLE_FRAMES);
});

test('re-centring stops once the row leaves the DOM', async () => {
  const { container, scrolls, runFrames, moveTo } = await revealAttachedRow();
  container.querySelector('[data-message-timestamp]')!.remove();
  moveTo(2400);
  await runFrames();
  assert.equal(frames.length, 0);
  assert.equal(scrolls(), 1);
});

test('a jump started while the session is still settling ends the settle', async () => {
  // The settle writes the bottom every frame for up to 60 frames while the
  // height keeps growing; the jump re-centres for at most 20, so a settle left
  // running outlasts it and the reveal ends at the bottom.
  store.getMessages.mockImplementation(() => [{
    id: 'm-0',
    kind: 'text',
    role: 'assistant',
    provider: 'claude',
    sessionId: session.id,
    content: 'a reply',
    timestamp: '2026-08-21T10:32:10.000Z',
  } as NormalizedMessage]);
  let resolveInitialLoad: (value: unknown) => void = () => {};
  store.fetchFromServer.mockImplementationOnce(() => new Promise((resolve) => { resolveInitialLoad = resolve; }) as never);
  const hook = await renderSessionState();
  let contentHeight = 4000;
  const pane = createPane({ contentHeight });
  // The row sits 1500px into the content; centring it in the 600px view puts
  // scrollTop at 1250.
  pane.addRow('2026-08-21T10:32:10.000Z', 1500);
  attachPane(hook, pane.container);
  frames.length = 0;

  // The first page lands and the settle starts.
  await act(async () => { resolveInitialLoad(fetched()); });
  assert.equal(frames.length, 1, 'the settle is running');
  await act(async () => {
    hook.result.current.revealMessage(hook.result.current.chatMessages[0]);
  });
  for (let frame = 0; frame < 100 && frames.length > 0; frame++) {
    // Rows below keep settling, so the settle never sees a stable height.
    contentHeight += 10;
    pane.setContentHeight(contentHeight);
    await act(async () => { frames.shift()?.(0); });
  }

  assert.equal(frames.length, 0);
  assert.equal(pane.getTop(), 1250);
});

test('a new message arriving while a reveal re-centres its row leaves the view on the row', async () => {
  // A reveal holds no search claim: the running jump alone keeps the
  // automatic follow to the bottom off.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const reply = (index: number, timestamp: string) => ({
    id: `m-${index}`,
    kind: 'text',
    role: 'assistant',
    provider: 'claude',
    sessionId: session.id,
    content: `reply ${index}`,
    timestamp,
  } as NormalizedMessage);
  store.getMessages.mockImplementation(() => [reply(0, '2026-08-21T10:32:10.000Z')]);
  const hook = await renderSessionState();
  const pane = createPane();
  const target = pane.addRow('2026-08-21T10:32:10.000Z', 1500);
  attachPane(hook, pane.container);
  await act(async () => { await vi.advanceTimersByTimeAsync(100); });
  frames.length = 0;

  await act(async () => { hook.result.current.revealMessage(hook.result.current.chatMessages[0]); });
  await act(async () => { frames.shift()?.(0); });
  assert.equal(pane.getTop(), 1250, 'the reveal landed');
  assert.ok(frames.length > 0, 'and is still re-centring');

  store.getMessages.mockImplementation(() => [reply(0, '2026-08-21T10:32:10.000Z'), reply(1, '2026-08-21T10:40:00.000Z')]);
  hook.rerender({ selected: session });
  await act(async () => { await vi.advanceTimersByTimeAsync(60); });
  assert.equal(pane.getTop(), 1250, 'the follow left the view alone');

  // The re-centring carries on.
  pane.moveRow(target, 1620);
  await act(async () => { frames.shift()?.(0); });
  assert.equal(pane.scrolls(target), 2);
});

test('the re-centring ends within a few frames of the row holding still', async () => {
  const { scrolls, moveTo } = await revealAttachedRow();
  moveTo(1620);
  await act(async () => { frames.shift()?.(0); });
  assert.equal(scrolls(), 2);

  let framesUntilStopped = 0;
  while (frames.length > 0 && framesUntilStopped < 30) {
    framesUntilStopped += 1;
    await act(async () => { frames.shift()?.(0); });
  }
  assert.equal(framesUntilStopped, CENTER_STABLE_FRAMES);
  assert.equal(scrolls(), 2);
});

test('switching sessions ends the re-centring', async () => {
  const { hook, scrolls, runFrames, moveTo } = await revealAttachedRow();

  hook.rerender({ selected: { ...session, id: 'session-b' } as ProjectSession });
  moveTo(2400);
  await runFrames();

  assert.equal(scrolls(), 1);
});

// A pane whose content ends at `maxScrollTop`, holding one row 1500px into the
// content that centring puts at scrollTop 1250.
const scrollablePane = (maxScrollTop: number) => {
  const pane = createPane({ contentHeight: maxScrollTop + PANE_HEIGHT });
  const target = pane.addRow('2026-08-21T10:32:10.000Z', 1500);
  return { ...pane, target, moveRowTo: (contentTop: number) => pane.moveRow(target, contentTop) };
};

const revealIn = async (pane: ReturnType<typeof scrollablePane>) => {
  const hook = await renderSessionState();
  attachPane(hook, pane.container);
  frames.length = 0;
  await act(async () => {
    hook.result.current.revealMessage({ type: 'assistant', content: '', timestamp: '2026-08-21T10:32:10.000Z' });
  });
  await act(async () => { frames.shift()?.(0); });
  return hook;
};

test('a jump and its re-centres note the writes that moved the view, and only those', async () => {
  const pane = scrollablePane(1400);
  await revealIn(pane);
  assert.equal(pane.getTop(), 1250);
  assert.equal(noteProgrammaticScroll.mock.calls.length, 1, 'the jump moved the view');

  pane.moveRowTo(1700);
  await act(async () => { frames.shift()?.(0); });
  assert.equal(pane.getTop(), 1400);
  assert.equal(noteProgrammaticScroll.mock.calls.length, 2, 'the re-centre moved the view');

  // At the end of the content the re-centre cannot move the view any further.
  pane.moveRowTo(1800);
  await act(async () => { frames.shift()?.(0); });
  assert.equal(pane.writes(), 3);
  assert.equal(pane.getTop(), 1400);
  assert.equal(noteProgrammaticScroll.mock.calls.length, 2);
});

test('a jump onto a row already centred notes nothing', async () => {
  const pane = scrollablePane(4000);
  pane.setTop(1250);
  await revealIn(pane);

  assert.equal(pane.writes(), 1);
  assert.equal(pane.scrolls(pane.target), 1);
  assert.equal(noteProgrammaticScroll.mock.calls.length, 0);
});

test('a scroll to the bottom notes its write only when it moved the view', async () => {
  const pane = scrollablePane(3400);
  const hook = await renderSessionState();
  attachPane(hook, pane.container);

  act(() => { hook.result.current.scrollToBottom(); });
  assert.equal(pane.getTop(), 3400);
  assert.equal(noteProgrammaticScroll.mock.calls.length, 1);
  act(() => { hook.result.current.scrollToBottom(); });
  assert.equal(noteProgrammaticScroll.mock.calls.length, 1);
});

test('the initial settle notes the write that moved the view, not its stable frames', async () => {
  store.getMessages.mockImplementation(() => [{
    id: 'm-0',
    kind: 'text',
    role: 'assistant',
    provider: 'claude',
    sessionId: session.id,
    content: 'a reply',
    timestamp: '2026-08-21T10:32:10.000Z',
  } as NormalizedMessage]);
  let resolveInitialLoad: (value: unknown) => void = () => {};
  store.fetchFromServer.mockImplementationOnce(() => new Promise((resolve) => { resolveInitialLoad = resolve; }) as never);
  const hook = await renderSessionState();
  const pane = scrollablePane(3400);
  attachPane(hook, pane.container);
  frames.length = 0;

  await act(async () => { resolveInitialLoad(fetched()); });
  let settleFrames = 0;
  while (frames.length > 0 && settleFrames < 100) {
    settleFrames += 1;
    await act(async () => { frames.shift()?.(0); });
  }

  // One move to the bottom, then three frames at the same height.
  assert.equal(settleFrames, 4);
  assert.equal(pane.getTop(), 3400);
  assert.equal(noteProgrammaticScroll.mock.calls.length, 1);
});

// A lookup still waiting for its row must not land once something else has
// taken the view: on its last attempt it settles for the nearest row, which
// by then can be any row, in any session.
describe('a jump still looking for its row', () => {
  const drainFrames = async () => {
    for (let frame = 0; frame < 60 && frames.length > 0; frame++) {
      await act(async () => { frames.shift()?.(0); });
    }
  };
  // A pane with one row near, but not at, the revealed timestamp.
  const revealAbsentRow = async () => {
    const hook = await renderSessionState();
    const pane = createPane();
    const near = pane.addRow('2026-08-21T10:32:09.000Z', 1500);
    attachPane(hook, pane.container);
    frames.length = 0;
    await act(async () => {
      hook.result.current.revealMessage({ type: 'assistant', content: '', timestamp: '2026-08-21T10:32:10.000Z' });
    });
    await act(async () => { frames.shift()?.(0); });
    await act(async () => { frames.shift()?.(0); });
    return { hook, pane, container: pane.container, near };
  };

  test('stops when the session changes', async () => {
    const { hook, pane, near } = await revealAbsentRow();

    hook.rerender({ selected: { ...session, id: 'session-b' } as ProjectSession });
    near.remove();
    const sessionBRow = pane.addRow('2026-08-21T11:00:00.000Z', 3000);
    await drainFrames();

    assert.equal(pane.scrolls(sessionBRow), 0);
  });

  test('stops when a newer reveal starts', async () => {
    const hook = await renderSessionState();
    const pane = createPane();
    const nearFirst = pane.addRow('2026-08-21T10:32:09.000Z', 1500);
    const second = pane.addRow('2026-08-21T10:40:00.000Z', 3000);
    attachPane(hook, pane.container);
    frames.length = 0;

    await act(async () => {
      hook.result.current.revealMessage({ type: 'assistant', content: '', timestamp: '2026-08-21T10:32:10.000Z' });
    });
    await act(async () => { frames.shift()?.(0); });
    await act(async () => {
      hook.result.current.revealMessage({ type: 'assistant', content: '', timestamp: '2026-08-21T10:40:00.000Z' });
    });
    await drainFrames();

    assert.equal(pane.scrolls(second), 1);
    assert.equal(pane.scrolls(nearFirst), 0);
  });

  test('stops when the view jumps to the bottom', async () => {
    const { hook, pane, near } = await revealAbsentRow();

    act(() => { hook.result.current.scrollToBottom(); });
    await drainFrames();

    assert.equal(pane.scrolls(near), 0);
  });

  test.each(USER_INPUT_EVENTS)('stops when the user scrolls the pane (%s)', async (type) => {
    const { pane, container, near } = await revealAbsentRow();

    container.dispatchEvent(new Event(type));
    await drainFrames();

    assert.equal(pane.scrolls(near), 0);
  });

  test('stops when the transcript unmounts', async () => {
    const { hook, pane, near } = await revealAbsentRow();

    hook.unmount();
    for (let frame = 0; frame < 60 && frames.length > 0; frame++) frames.shift()?.(0);

    assert.equal(pane.scrolls(near), 0);
  });

  test('a search lookup stops when the view jumps to the bottom', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    store.getMessages.mockImplementation(() => [{
      id: 'm-0',
      kind: 'tool_use',
      provider: 'claude',
      sessionId: session.id,
      toolName: 'Read',
      toolInput: { file_path: 'the file the sidebar search found' },
      toolId: 'tool-1',
      timestamp: '2026-08-21T10:32:10.000Z',
    } as NormalizedMessage]);
    const hook = await renderSessionState({ ...session, __searchTargetSnippet: 'the file the sidebar search found', __searchTargetTimestamp: '2026-08-21T10:32:10.000Z' } as ProjectSession);
    const pane = createPane();
    // The tool group the hit is collapsed into, stamped with an earlier call's time.
    const group = pane.addRow('2026-08-21T10:32:05.000Z', 1500);
    attachPane(hook, pane.container);

    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    act(() => { hook.result.current.scrollToBottom(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(3400); });

    assert.equal(pane.scrolls(group), 0);
    assert.equal(group.classList.contains('search-highlight-flash'), false);
  });
});

// A sidebar search hit in the open session, whose whole transcript the jump
// fetches first (held until the test resolves it); its row sits 1500px into
// the pane's content.
describe('a search jump', () => {
  const HIT_TIMESTAMP = '2026-08-21T10:32:10.000Z';
  const hitMessage = (index = 0, timestamp = HIT_TIMESTAMP) => ({
    id: `m-${index}`,
    kind: 'text',
    role: 'user',
    provider: 'claude',
    sessionId: session.id,
    content: index === 0 ? 'the message the sidebar search found' : `a later message ${index}`,
    timestamp,
  } as NormalizedMessage);
  const searchSession = { ...session, __searchTargetSnippet: 'message the sidebar search found', __searchTargetTimestamp: HIT_TIMESTAMP } as ProjectSession;
  const BOTTOM = 10_000 - PANE_HEIGHT;

  // Holds the whole-transcript fetch until the test settles it; a page
  // answers at once with `firstPage`.
  const holdFullFetch = (firstPage = fetched()) => {
    const full: { resolve: (value: unknown) => void; reject: (reason: unknown) => void } = { resolve: () => {}, reject: () => {} };
    store.fetchFromServer.mockImplementation(((_sessionId: string, options?: { limit?: number | null }) => (
      options?.limit === null
        ? new Promise((resolve, reject) => { full.resolve = resolve; full.reject = reject; })
        : Promise.resolve(firstPage)
    )) as never);
    return full;
  };
  const fullFetchCount = () => (store.fetchFromServer.mock.calls as unknown[][])
    .filter(([, options]) => (options as { limit?: unknown })?.limit === null).length;
  const wait = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

  const searchHit = async ({ withRow = true, firstPage = fetched(), viewportTop = 0 } = {}) => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    store.getMessages.mockImplementation(() => [hitMessage()]);
    const full = holdFullFetch(firstPage);
    const hook = await renderSessionState(searchSession);
    const pane = createPane({ viewportTop });
    const target = withRow ? pane.addRow(HIT_TIMESTAMP, 1500) : null;
    attachPane(hook, pane.container);
    await act(async () => {});
    assert.equal(fullFetchCount(), 1, 'the jump is fetching the whole transcript');
    const loaded = () => act(async () => { full.resolve(fetched({ total: 1, offset: 1 })); });
    // A new message arrives while the user is at the bottom.
    const newMessageArrives = async () => {
      store.getMessages.mockImplementation(() => [hitMessage(), hitMessage(1, '2026-08-21T10:40:00.000Z')]);
      hook.rerender({ selected: searchSession });
      await wait(60);
    };
    return { hook, pane, target, full, loaded, wait, newMessageArrives };
  };

  test('lands on its row once the transcript is loaded', async () => {
    const { pane, target, loaded, wait } = await searchHit();

    await loaded();
    await wait(200);

    assert.equal(pane.scrolls(target!), 1);
  });

  test('still loading its transcript, is dropped by a scroll to the bottom', async () => {
    const { hook, pane, target, loaded, wait } = await searchHit();

    act(() => { hook.result.current.scrollToBottom(); });
    await loaded();
    await wait(3400);

    assert.equal(pane.scrolls(target!), 0);
    assert.equal(target!.classList.contains('search-highlight-flash'), false);
  });

  test.each(USER_INPUT_EVENTS)('still loading its transcript, is dropped by the user scrolling the pane (%s)', async (type) => {
    const { pane, target, loaded, wait } = await searchHit();

    pane.container.dispatchEvent(new Event(type));
    await loaded();
    await wait(3400);

    assert.equal(pane.scrolls(target!), 0);
  });

  test('still loading its transcript, does not stop a reveal started meanwhile', async () => {
    const { hook, pane, loaded } = await searchHit();
    frames.length = 0;

    await act(async () => {
      hook.result.current.revealMessage({ type: 'assistant', content: '', timestamp: '2026-08-21T10:50:00.000Z' });
    });
    // The revealed row is not committed yet when the search's transcript lands.
    await act(async () => { frames.shift()?.(0); });
    await loaded();
    const revealed = pane.addRow('2026-08-21T10:50:00.000Z', 4000);
    for (let frame = 0; frame < 60 && frames.length > 0; frame++) {
      await act(async () => { frames.shift()?.(0); });
    }

    assert.equal(pane.scrolls(revealed), 1);
  });

  test('whose transcript lands behind another tab lands once the Chat tab is shown again', async () => {
    const { hook, pane, target, loaded, wait } = await searchHit();

    hook.rerender({ selected: searchSession, active: false });
    pane.setHidden(true);
    await loaded();
    await wait(3400);
    assert.equal(pane.scrolls(target!), 0, 'nothing to centre in a hidden pane');

    pane.setHidden(false);
    hook.rerender({ selected: searchSession, active: true });
    await wait(200);

    assert.equal(pane.scrolls(target!), 1);
  });

  test('whose row would be found behind another tab lands once the Chat tab is shown again', async () => {
    const { hook, pane, target, loaded, wait } = await searchHit();

    await loaded();
    // Hidden before the first lookup, 150ms on.
    hook.rerender({ selected: searchSession, active: false });
    pane.setHidden(true);
    await wait(3400);
    assert.equal(pane.scrolls(target!), 0);

    pane.setHidden(false);
    hook.rerender({ selected: searchSession, active: true });
    await wait(200);

    assert.equal(pane.scrolls(target!), 1);
  });

  test('lets the transcript follow new messages again once it has landed', async () => {
    const { pane, target, loaded, wait, newMessageArrives } = await searchHit();
    await loaded();
    await wait(200);
    assert.equal(pane.scrolls(target!), 1);
    // The follow also waits for the re-centring, which ends once the row
    // holds still.
    for (let frame = 0; frame < 30 && frames.length > 0; frame++) {
      await act(async () => { frames.shift()?.(0); });
    }

    await newMessageArrives();

    assert.equal(pane.getTop(), BOTTOM);
  });

  test('lets the transcript follow new messages again once its lookup ran out of retries', async () => {
    const { pane, loaded, wait, newMessageArrives } = await searchHit({ withRow: false });
    await loaded();
    await wait(3400);

    await newMessageArrives();

    assert.equal(pane.getTop(), BOTTOM);
  });

  // A jump that gives up held the initial settle and the follow off while it
  // was pending, and nothing else brings the view back down.
  describe('that ends without landing', () => {
    test('because its hit is not in the transcript, leaves a session opened from it at the bottom', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      store.getMessages.mockImplementation(() => [hitMessage()]);
      // No timestamp, so nothing stands in for the missing phrase.
      const hook = await renderSessionState({ ...session, __searchTargetSnippet: 'a phrase found nowhere in this transcript' } as ProjectSession);
      const pane = createPane();
      attachPane(hook, pane.container);

      await wait(400);

      assert.equal(fullFetchCount(), 1, 'the jump looked in the whole transcript');
      assert.equal(pane.getTop(), BOTTOM);
    });

    test('because its lookup ran out of retries, follows the new messages that arrived meanwhile', async () => {
      const { pane, loaded, wait, newMessageArrives } = await searchHit({ withRow: false });
      await loaded();
      await wait(400);
      await newMessageArrives();
      assert.notEqual(pane.getTop(), BOTTOM, 'the follow is off while the jump looks for its row');

      await wait(3400);

      assert.equal(pane.getTop(), BOTTOM);
    });

    test('stopped by the user scrolling the pane, leaves the view where the user put it', async () => {
      const { pane, loaded, wait, newMessageArrives } = await searchHit({ withRow: false });
      await loaded();
      await wait(400);
      await newMessageArrives();

      pane.container.dispatchEvent(new Event('wheel'));
      await wait(3400);

      assert.equal(pane.getTop(), 0);
    });
  });

  test('armed but not started yet, is dropped by a scroll to the bottom', async () => {
    // The hit waits for the session's first page before it starts its jump.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    store.getMessages.mockImplementation(() => [hitMessage()]);
    let resolvePage: (value: unknown) => void = () => {};
    store.fetchFromServer.mockImplementation(((_sessionId: string, options?: { limit?: number | null }) => (
      options?.limit === null
        ? Promise.resolve(fetched({ total: 1, offset: 1 }))
        : new Promise((resolve) => { resolvePage = resolve; })
    )) as never);
    const hook = await renderSessionState(searchSession);
    const pane = createPane();
    const target = pane.addRow(HIT_TIMESTAMP, 1500);
    attachPane(hook, pane.container);
    await act(async () => {});
    assert.equal(hook.result.current.isLoadingSessionMessages, true);

    act(() => { hook.result.current.scrollToBottom(); });
    await act(async () => { resolvePage(fetched()); });
    await wait(3400);

    assert.equal(fullFetchCount(), 0, 'the jump never started');
    assert.equal(pane.scrolls(target), 0);
  });

  test('keeps the follow off while a second search takes over from the first', async () => {
    const { hook, pane, loaded, wait } = await searchHit({ withRow: false });
    await loaded();
    await wait(400);

    // Another hit in the same session; its row is not rendered yet either.
    const secondSearch = { ...session, __searchTargetSnippet: 'a later message 1', __searchTargetTimestamp: '2026-08-21T10:40:00.000Z' } as ProjectSession;
    store.getMessages.mockImplementation(() => [hitMessage(), hitMessage(1, '2026-08-21T10:40:00.000Z')]);
    hook.rerender({ selected: secondSearch });
    await wait(10);
    // A new message arrives while the second one looks for its row.
    store.getMessages.mockImplementation(() => [
      hitMessage(),
      hitMessage(1, '2026-08-21T10:40:00.000Z'),
      hitMessage(2, '2026-08-21T10:45:00.000Z'),
    ]);
    hook.rerender({ selected: secondSearch });
    await wait(60);

    assert.notEqual(pane.getTop(), BOTTOM);
  });

  test.each(USER_INPUT_EVENTS)('looking for its row, is dropped by the user scrolling the pane (%s)', async (type) => {
    const { pane, loaded, wait } = await searchHit({ withRow: false });
    await loaded();
    await wait(400);
    // The row the last attempt would settle for.
    const nearest = pane.addRow('2026-08-21T10:32:05.000Z', 3000);

    pane.container.dispatchEvent(new Event(type));
    await wait(3400);

    assert.equal(pane.scrolls(nearest), 0);
  });

  test('keeps its highlight on until the flash has played', async () => {
    const { pane, target, loaded, wait } = await searchHit();
    await loaded();
    await wait(200);
    assert.equal(pane.scrolls(target!), 1);

    // The row was still a placeholder, so its flash started late.
    await wait(4000);
    assert.equal(target!.classList.contains('search-highlight-flash'), true);
    target!.dispatchEvent(Object.assign(new Event('animationstart'), { animationName: 'search-flash' }));

    // A flash inside the row, or another animation of the row, is not it.
    const child = document.createElement('span');
    target!.appendChild(child);
    child.dispatchEvent(Object.assign(new Event('animationend', { bubbles: true }), { animationName: 'search-flash' }));
    target!.dispatchEvent(Object.assign(new Event('animationend'), { animationName: 'fade-in' }));
    assert.equal(target!.classList.contains('search-highlight-flash'), true);

    target!.dispatchEvent(Object.assign(new Event('animationend'), { animationName: 'search-flash' }));
    assert.equal(target!.classList.contains('search-highlight-flash'), false);
  });

  test('drops its highlight in the end even if the flash never played', async () => {
    const { pane, target, loaded, wait } = await searchHit();
    await loaded();
    await wait(200);
    assert.equal(pane.scrolls(target!), 1);

    await wait(10_000);

    assert.equal(target!.classList.contains('search-highlight-flash'), false);
  });

  // Following the bottom on its own (an external update's refresh, a new
  // message) is not the user leaving the jump: it waits for the jump instead
  // of dropping it.
  describe('still loading its transcript, is not dropped by an automatic follow to the bottom', () => {
    // The user at the bottom of the open session, which an external update
    // has already refreshed; the sidebar then hands over a search hit in it.
    const searchFromTheBottom = async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      store.getMessages.mockImplementation(() => [hitMessage()]);
      const full = holdFullFetch();
      const hook = await renderSessionState(session, { externalMessageUpdate: 1 });
      const pane = createPane({ top: BOTTOM });
      const target = pane.addRow(HIT_TIMESTAMP, 1500);
      attachPane(hook, pane.container);
      await act(async () => {});
      return { hook, pane, target, full };
    };

    test('the refresh of an external update counted before the search', async () => {
      const { hook, pane, target, full } = await searchFromTheBottom();
      // The update comes in with the user at the bottom, so its refresh arms
      // the 200ms follow; the search click comes before that fires.
      const timers = vi.spyOn(globalThis, 'setTimeout');
      hook.rerender({ selected: session, externalMessageUpdate: 2 });
      await act(async () => {});
      assert.ok(timers.mock.calls.some(([, delay]) => delay === 200), 'the refresh armed its follow');

      const writesAtClick = pane.writes();
      hook.rerender({ selected: searchSession, externalMessageUpdate: 2 });
      await act(async () => {});
      assert.equal(fullFetchCount(), 1, 'the jump is fetching the whole transcript');
      // The transcript takes longer than the refresh's 200ms follow.
      await wait(400);
      assert.equal(pane.writes(), writesAtClick, 'the view is left alone while the jump is pending');
      await act(async () => { full.resolve(fetched({ total: 1, offset: 1 })); });
      await wait(200);

      assert.equal(pane.scrolls(target), 1);
    });

    test('the refresh of an external update arriving during the fetch', async () => {
      const { hook, pane, target, full } = await searchFromTheBottom();
      hook.rerender({ selected: searchSession, externalMessageUpdate: 1 });
      await act(async () => {});

      const writesAtUpdate = pane.writes();
      hook.rerender({ selected: searchSession, externalMessageUpdate: 2 });
      await wait(400);
      assert.equal(pane.writes(), writesAtUpdate, 'the view is left alone while the jump is pending');
      await act(async () => { full.resolve(fetched({ total: 1, offset: 1 })); });
      await wait(200);

      assert.equal(pane.scrolls(target), 1);
    });

    test('a follow to the bottom armed just before the search', async () => {
      const { hook, pane, target, full } = await searchFromTheBottom();

      // A new message arms the follow; the search click comes before it fires.
      const writesBefore = pane.writes();
      store.getMessages.mockImplementation(() => [hitMessage(), hitMessage(1, '2026-08-21T10:40:00.000Z')]);
      hook.rerender({ selected: session, externalMessageUpdate: 1 });
      hook.rerender({ selected: searchSession, externalMessageUpdate: 1 });
      await act(async () => {});
      assert.equal(fullFetchCount(), 1, 'the jump is fetching the whole transcript');
      await wait(400);
      assert.equal(pane.writes(), writesBefore, 'the view is left alone while the jump is pending');
      await act(async () => { full.resolve(fetched({ total: 2, offset: 2 })); });
      await wait(200);

      assert.equal(pane.scrolls(target), 1);
    });
  });

  // Behind another tab a jump is put back for the tab's return; one stopped
  // while its transcript loaded must not be.
  describe('stopped while its transcript loads, then left behind another tab', () => {
    const stopHideAndSettle = async (settle: (full: { resolve: (value: unknown) => void; reject: (reason: unknown) => void }) => void) => {
      const { hook, pane, target, full, wait } = await searchHit();
      act(() => { hook.result.current.scrollToBottom(); });
      hook.rerender({ selected: searchSession, active: false });
      pane.setHidden(true);
      await act(async () => { settle(full); });
      await wait(3400);

      pane.setHidden(false);
      hook.rerender({ selected: searchSession, active: true });
      await wait(10);
      // A jump put back for the tab's return would fetch the transcript
      // again (a failed one is not in the store): that fetch lands too.
      await act(async () => { full.resolve(fetched({ total: 1, offset: 1 })); });
      await wait(3400);
      assert.equal(fullFetchCount(), 1, 'nothing is fetched again for the stopped jump');
      return { pane, target: target! };
    };

    test('does not land once its transcript has loaded and the tab is shown', async () => {
      const { pane, target } = await stopHideAndSettle((full) => full.resolve(fetched({ total: 1, offset: 1 })));

      assert.equal(pane.scrolls(target), 0);
      assert.equal(target.classList.contains('search-highlight-flash'), false);
    });

    test('does not land once its fetch has failed and the tab is shown', async () => {
      // A failure the store reports through its result.
      const { pane, target } = await stopHideAndSettle((full) => full.resolve({ slot, ok: false }));

      assert.equal(pane.scrolls(target), 0);
    });

    test('does not land once its fetch has thrown and the tab is shown', async () => {
      const { pane, target } = await stopHideAndSettle((full) => full.reject(new Error('offline')));

      assert.equal(pane.scrolls(target), 0);
      assert.equal(target.classList.contains('search-highlight-flash'), false);
    });
  });

  test('put back behind another tab, is dropped by a session change there', async () => {
    const { hook, pane, target, loaded, wait } = await searchHit();
    hook.rerender({ selected: searchSession, active: false });
    pane.setHidden(true);
    await loaded();
    await wait(3400);
    assert.equal(pane.scrolls(target!), 0, 'put back for the tab\'s return');

    const sessionB = { ...session, id: 'session-b' } as ProjectSession;
    hook.rerender({ selected: sessionB, active: false });
    pane.setHidden(false);
    hook.rerender({ selected: sessionB, active: true });
    await wait(10);
    // A whole-transcript fetch the dropped hit might have asked for lands.
    await loaded();
    await wait(3400);

    assert.equal(fullFetchCount(), 1, 'nothing more is fetched for the dropped hit');
    assert.equal(pane.scrolls(target!), 0);
    assert.equal(target!.classList.contains('search-highlight-flash'), false);
    // The new session follows its new messages.
    pane.setTop(5000);
    store.getMessages.mockImplementation(() => [hitMessage(), hitMessage(1, '2026-08-21T10:40:00.000Z')]);
    hook.rerender({ selected: sessionB, active: true });
    await wait(60);
    assert.equal(pane.getTop(), BOTTOM);
  });

  test('stopped while its transcript loads, still counts the whole transcript as loaded', async () => {
    // The store holds every message once the fetch lands, whoever stopped the
    // jump meanwhile; paging on from the first page would ask for rows it has.
    const { hook, pane, target, loaded, wait } = await searchHit({ firstPage: fetched({ total: 300, hasMore: true, offset: 100 }) });
    assert.equal(hook.result.current.hasMoreMessages, true);

    act(() => { hook.result.current.scrollToBottom(); });
    await loaded();
    await wait(3400);

    assert.equal(hook.result.current.hasMoreMessages, false);
    assert.equal(hook.result.current.allMessagesLoaded, true);
    assert.equal(hook.result.current.totalMessages, 1);
    assert.equal(pane.scrolls(target!), 0);
  });
});

test('a reveal flashes the row it lands on', async () => {
  const { pane } = await revealAttachedRow();
  const target = pane.container.querySelector('[data-message-timestamp]')!;

  assert.equal(target.classList.contains('search-highlight-flash'), true);
});

test('a second jump onto a row still flashing restarts its flash', async () => {
  const { hook, pane, runFrames } = await revealAttachedRow();
  const target = pane.container.querySelector('[data-message-timestamp]')!;
  const flashEvent = (type: string) => target.dispatchEvent(Object.assign(new Event(type), { animationName: 'search-flash' }));
  flashEvent('animationstart');
  // Taking the class off and putting it back in one go is no change to the
  // browser, which lets the running flash carry on: the restart has to read
  // layout in between, with the class off.
  const classOnAtLayoutRead: boolean[] = [];
  Object.defineProperty(target, 'offsetWidth', {
    configurable: true,
    get: () => {
      classOnAtLayoutRead.push(target.classList.contains('search-highlight-flash'));
      return 800;
    },
  });

  await act(async () => {
    hook.result.current.revealMessage({ type: 'assistant', content: '', timestamp: '2026-08-21T10:32:10.000Z' });
  });
  await runFrames();
  assert.deepEqual(classOnAtLayoutRead, [false]);
  assert.equal(target.classList.contains('search-highlight-flash'), true);

  // The first flash's end, already on its way, is not the second one's.
  flashEvent('animationend');
  assert.equal(target.classList.contains('search-highlight-flash'), true);

  flashEvent('animationstart');
  flashEvent('animationend');
  assert.equal(target.classList.contains('search-highlight-flash'), false);
});

test('returning to the Chat tab notes the write that moved the view', async () => {
  const hook = await renderSessionState();
  const pane = createPane();
  attachPane(hook, pane.container);

  hook.rerender({ selected: session, active: false });
  pane.setTop(500);
  noteProgrammaticScroll.mockClear();
  hook.rerender({ selected: session, active: true });

  // Following the bottom, so the return goes there.
  assert.equal(pane.getTop(), 10_000 - PANE_HEIGHT);
  assert.equal(noteProgrammaticScroll.mock.calls.length, 1);
});

describe('a New Session click on the same route', () => {
  test('ends a re-centring', async () => {
    const { hook, scrolls, runFrames, moveTo } = await revealAttachedRow();

    hook.rerender({ selected: session, newSessionTrigger: 1 });
    moveTo(2400);
    await runFrames();

    assert.equal(scrolls(), 1);
  });

  test('stops a reveal still looking for its row', async () => {
    const hook = await renderSessionState();
    const pane = createPane();
    const near = pane.addRow('2026-08-21T10:32:09.000Z', 1500);
    attachPane(hook, pane.container);
    frames.length = 0;
    await act(async () => {
      hook.result.current.revealMessage({ type: 'assistant', content: '', timestamp: '2026-08-21T10:32:10.000Z' });
    });
    await act(async () => { frames.shift()?.(0); });

    hook.rerender({ selected: session, newSessionTrigger: 1 });
    for (let frame = 0; frame < 60 && frames.length > 0; frame++) {
      await act(async () => { frames.shift()?.(0); });
    }

    assert.equal(pane.scrolls(near), 0);
  });
});

describe('an external update', () => {
  test('arriving while the user is at the bottom follows the refreshed rows down', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const hook = await renderSessionState();
    const pane = createPane({ top: 10_000 - PANE_HEIGHT });
    attachPane(hook, pane.container);
    await act(async () => {});
    // The refreshed rows lay out taller than the view had room for.
    store.refreshLatestFromServer.mockImplementation(async () => {
      pane.setContentHeight(10_500);
      return { slot, deferred: false };
    });

    hook.rerender({ selected: session, externalMessageUpdate: 1 });
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });

    assert.equal(store.refreshLatestFromServer.mock.calls.length, 1);
    assert.equal(pane.getTop(), 10_500 - PANE_HEIGHT);
  });

  test('is not refreshed while a response is in flight, and the next one after it is', async () => {
    const busy: SessionActivityMap = new Map([[session.id, { statusText: null, canInterrupt: true, startedAt: 0 }]]);
    const hook = await renderSessionState(session, { processingSessions: busy });
    await act(async () => {});

    hook.rerender({ selected: session, processingSessions: busy, externalMessageUpdate: 1 });
    await act(async () => {});
    assert.equal(store.refreshLatestFromServer.mock.calls.length, 0);

    hook.rerender({ selected: session, processingSessions: new Map(), externalMessageUpdate: 1 });
    await act(async () => {});
    assert.equal(store.refreshLatestFromServer.mock.calls.length, 0, 'the response ending refreshes nothing by itself');

    hook.rerender({ selected: session, processingSessions: new Map(), externalMessageUpdate: 2 });
    await act(async () => {});
    assert.equal(store.refreshLatestFromServer.mock.calls.length, 1);
  });

  test('is refreshed once, not again when the sidebar hands over a new object for the same session', async () => {
    // A sidebar search click hands over a new session object; refreshing on it
    // armed another follow to the bottom, over the jump it had just started.
    const hook = await renderSessionState(session, { externalMessageUpdate: 1 });
    await act(async () => {});
    assert.equal(store.refreshLatestFromServer.mock.calls.length, 1);

    hook.rerender({ selected: { ...session } as ProjectSession, externalMessageUpdate: 1 });
    await act(async () => {});
    assert.equal(store.refreshLatestFromServer.mock.calls.length, 1);

    hook.rerender({ selected: { ...session } as ProjectSession, externalMessageUpdate: 2 });
    await act(async () => {});
    assert.equal(store.refreshLatestFromServer.mock.calls.length, 2, 'the next update is refreshed');
  });
});
