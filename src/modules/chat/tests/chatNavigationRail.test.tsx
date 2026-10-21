import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';

import '@/modules/i18n';
import ChatNavigationRail from '@/modules/chat/transcript/ChatNavigationRail';
import type { ChatMessage } from '@/shared/types';

/**
 * The rail is tested against a fake pane the test owns: detached rows
 * carrying the same `data-message-timestamp` attribute LazyMessageRow
 * renders, with geometry pinned through stubbed bounding rects and the
 * container's reading line at (top + bottom) / 2 = 450.
 */

const userTurn = (timestamp: string, overrides: Partial<ChatMessage> = {}): ChatMessage => ({
  type: 'user',
  content: '',
  timestamp,
  ...overrides,
});

/** A fake pane row at a fixed viewport-top, like a rendered LazyMessageRow. */
const paneRow = (timestamp: string, top: number): HTMLElement => {
  const element = document.createElement('div');
  element.setAttribute('data-message-timestamp', timestamp);
  element.getBoundingClientRect = () => ({ top } as DOMRect);
  return element;
};

/** jsdom does not implement scrollIntoView; the rail's follow-scroll needs it. */
type ElementWithScrollIntoView = { scrollIntoView?: (options?: { block?: string }) => void };
const scrollIntoViewMock = vi.fn();
const originalScrollIntoView = (Element.prototype as ElementWithScrollIntoView).scrollIntoView;

// Frames run by hand so a scroll's measure runs exactly when the test says.
const frames: FrameRequestCallback[] = [];

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  (Element.prototype as ElementWithScrollIntoView).scrollIntoView = scrollIntoViewMock;
  scrollIntoViewMock.mockClear();
});

afterEach(() => {
  frames.length = 0;
  vi.unstubAllGlobals();
  const host = Element.prototype as ElementWithScrollIntoView;
  if (originalScrollIntoView) {
    host.scrollIntoView = originalScrollIntoView;
  } else {
    delete host.scrollIntoView;
  }
});

const flushFrames = async () => {
  while (frames.length > 0) {
    const frame = frames.shift();
    await act(async () => {
      frame?.(0);
    });
  }
};

type RailHarness = {
  container: HTMLDivElement;
  onReveal: ReturnType<typeof vi.fn>;
  onLoadFullTranscript: ReturnType<typeof vi.fn>;
  unmount: () => void;
  rerender: (sessionId: string | null, nextMessages: ChatMessage[]) => void;
};

const renderRail = (
  messages: ChatMessage[],
  rows: HTMLElement[] = [],
  options: { sessionId?: string | null; onLoadFullTranscript?: ReturnType<typeof vi.fn> } = {},
): RailHarness => {
  const container = document.createElement('div');
  container.getBoundingClientRect = () => ({ top: 0, bottom: 900 } as DOMRect);
  rows.forEach((row) => container.appendChild(row));
  const onReveal = vi.fn();
  const onLoadFullTranscript = options.onLoadFullTranscript ?? vi.fn(async () => []);
  const element = (sessionId: string | null, railMessages: ChatMessage[]) => (
    <ChatNavigationRail
      messages={railMessages}
      sessionId={sessionId}
      scrollContainerRef={{ current: container }}
      onReveal={onReveal}
      onLoadFullTranscript={onLoadFullTranscript}
    />
  );
  const sessionId = options.sessionId === undefined ? 'session-1' : options.sessionId;
  const view = render(element(sessionId, messages));
  return {
    container,
    onReveal,
    onLoadFullTranscript,
    unmount: view.unmount,
    rerender: (nextSessionId, nextMessages) => view.rerender(element(nextSessionId, nextMessages)),
  };
};

describe('the conversation navigation rail', () => {
  it('renders nothing without user turns and a single dash for a single turn', () => {
    const empty = renderRail([{ type: 'assistant', content: 'hi', timestamp: '2026-01-01T00:00:02.000Z' }]);
    expect(empty.container.querySelector('[role="navigation"]')).toBeNull();

    renderRail([userTurn('2026-01-01T00:00:01.000Z')]);
    expect(screen.getByRole('button', { name: 'Go to message 1' })).toBeTruthy();
  });

  it('shows one dash per user turn and none for assistant rows', () => {
    renderRail([
      userTurn('2026-01-01T00:00:01.000Z'),
      { type: 'assistant', content: 'hi', timestamp: '2026-01-01T00:00:02.000Z' },
      userTurn('2026-01-01T00:00:03.000Z'),
    ]);

    expect(screen.getByRole('button', { name: 'Go to message 1' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Go to message 2' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Go to message 3' })).toBeNull();
  });

  it('reveals the clicked turn through onReveal', () => {
    const turns = [
      userTurn('2026-01-01T00:00:01.000Z'),
      userTurn('2026-01-01T00:00:03.000Z', { content: 'second' }),
    ];
    const { onReveal } = renderRail(turns);

    fireEvent.click(screen.getByRole('button', { name: 'Go to message 2' }));
    expect(onReveal).toHaveBeenCalledWith(turns[1]);
  });

  it('expands on hover and previews displayText over content, whitespace collapsed', () => {
    const { onReveal } = renderRail([
      userTurn('2026-01-01T00:00:01.000Z', {
        content: 'raw\n   one',
        displayText: '  display     one  ',
      }),
      userTurn('2026-01-01T00:00:03.000Z', { content: 'second turn' }),
    ]);

    fireEvent.mouseEnter(screen.getByRole('navigation'));
    const row = screen.getByRole('button', { name: 'display one' });
    expect(row.textContent).toBe('display one');
    expect(screen.getByRole('button', { name: 'second turn' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'second turn' }));
    expect(onReveal).toHaveBeenCalledTimes(1);
  });

  it('labels a turn that is only an attachment', () => {
    renderRail([
      userTurn('2026-01-01T00:00:01.000Z', {
        images: [{}],
      }),
      userTurn('2026-01-01T00:00:03.000Z', { content: 'second' }),
    ]);

    fireEvent.mouseEnter(screen.getByRole('navigation'));
    expect(screen.getByRole('button', { name: 'Attachment' })).toBeTruthy();
  });

  it('bounds dash column and card to one region with its own scrollbar', () => {
    renderRail([
      userTurn('2026-01-01T00:00:01.000Z', { content: 'first' }),
      userTurn('2026-01-01T00:00:03.000Z', { content: 'second' }),
    ]);

    // Collapsed, the dash column is already bounded (max-h-72) instead of
    // growing unbounded down the page; pinned where jsdom cannot lay out.
    const nav = screen.getByRole('navigation');
    const list = nav.querySelector('.max-h-72');
    expect(list).toBeTruthy();
    expect(list?.classList.contains('overflow-y-auto')).toBe(true);

    // Expanding turns the same list into the card in place — no second
    // scrolling region appears beside the dashes.
    fireEvent.mouseEnter(nav);
    expect(nav.querySelectorAll('.max-h-72')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'first' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'second' })).toBeTruthy();
  });

  it('follows the scroll position and highlights the turn at the reading line', async () => {
    const first = paneRow('2026-01-01T00:00:01.000Z', 100);
    const second = paneRow('2026-01-01T00:00:03.000Z', 600);
    const { container } = renderRail(
      [
        userTurn('2026-01-01T00:00:01.000Z'),
        userTurn('2026-01-01T00:00:03.000Z'),
      ],
      [first, second],
    );

    // Reading line at 450: the first turn is above it, the second below.
    expect(screen.getByRole('button', { name: 'Go to message 1' }).getAttribute('aria-current')).toBe('location');
    expect(screen.getByRole('button', { name: 'Go to message 2' }).getAttribute('aria-current')).toBeNull();

    // Scroll down: both turns move up, the second crosses the line.
    first.getBoundingClientRect = () => ({ top: -800 } as DOMRect);
    second.getBoundingClientRect = () => ({ top: 100 } as DOMRect);
    fireEvent.scroll(container);
    await flushFrames();

    expect(screen.getByRole('button', { name: 'Go to message 1' }).getAttribute('aria-current')).toBeNull();
    expect(screen.getByRole('button', { name: 'Go to message 2' }).getAttribute('aria-current')).toBe('location');
  });

  it('falls back to the first turn when every turn is still below the reading line', () => {
    renderRail(
      [
        userTurn('2026-01-01T00:00:01.000Z'),
        userTurn('2026-01-01T00:00:03.000Z'),
      ],
      [
        paneRow('2026-01-01T00:00:01.000Z', 600),
        paneRow('2026-01-01T00:00:03.000Z', 700),
      ],
    );

    expect(screen.getByRole('button', { name: 'Go to message 1' }).getAttribute('aria-current')).toBe('location');
  });

  it('scrolls the expanded panel to the active row', () => {
    renderRail([
      userTurn('2026-01-01T00:00:01.000Z', { content: 'first' }),
      userTurn('2026-01-01T00:00:03.000Z', { content: 'second' }),
    ]);

    // The dash-follow effect also fires on mount (a browser no-op); what
    // matters is that expanding scrolls the active panel row into view.
    scrollIntoViewMock.mockClear();
    fireEvent.mouseEnter(screen.getByRole('navigation'));
    expect(scrollIntoViewMock).toHaveBeenCalled();
  });

  it('fetches the full transcript once on session entry, not on hover', () => {
    const { onLoadFullTranscript } = renderRail([
      userTurn('2026-01-01T00:00:01.000Z'),
      userTurn('2026-01-01T00:00:03.000Z'),
    ]);

    // The entry fetch has already fired at mount; hovering the rail (or
    // leaving and re-entering) must not fetch the transcript again.
    expect(onLoadFullTranscript).toHaveBeenCalledTimes(1);
    fireEvent.mouseEnter(screen.getByRole('navigation'));
    fireEvent.mouseLeave(screen.getByRole('navigation'));
    expect(onLoadFullTranscript).toHaveBeenCalledTimes(1);
  });

  it('refetches when the session changes; a failed fetch keeps the window listing', async () => {
    const failing = vi.fn(async () => {
      throw new Error('offline');
    });
    const { rerender } = renderRail(
      [userTurn('2026-01-01T00:00:01.000Z', { content: 'first' })],
      [],
      { sessionId: 'session-1', onLoadFullTranscript: failing },
    );

    // The entry fetch rejects; the rail still lists the loaded window's turn.
    await act(async () => {
      await Promise.resolve();
    });
    expect(failing).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Go to message 1' })).toBeTruthy();

    // A different session fetches fresh through the same (stable) callback.
    rerender('session-2', [userTurn('2026-01-02T00:00:01.000Z')]);
    expect(failing).toHaveBeenCalledTimes(2);
  });
});
