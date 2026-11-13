import { afterEach, describe, expect, it, vi } from 'vitest';
import React, { useRef } from 'react';
import { render } from '@testing-library/react';

import LazyMessageRow from '@/modules/chat/transcript/LazyMessageRow';

/**
 * Drivable ResizeObserver stand-in: jsdom has none, so these tests install one
 * and fire its callback by hand to walk a row through height changes. The
 * component under test reads sizes from getBoundingClientRect, so the entries
 * here are placeholders.
 */
class StubResizeObserver {
  static instances: StubResizeObserver[] = [];

  callback: ResizeObserverCallback;
  observed: Element[] = [];

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    StubResizeObserver.instances.push(this);
  }

  observe(element: Element): void {
    this.observed.push(element);
  }

  unobserve(element: Element): void {
    this.observed = this.observed.filter((observed) => observed !== element);
  }

  disconnect(): void {
    this.observed = [];
  }
}

function fireResize(observer: StubResizeObserver, target: Element): void {
  observer.callback(
    [{ target } as ResizeObserverEntry],
    observer as unknown as ResizeObserver,
  );
}

/** The viewport top the container pretends to have; rows above it are off-screen. */
const CONTAINER_TOP_PX = 200;

function Harness() {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  return (
    <div ref={scrollContainerRef}>
      <LazyMessageRow
        lazyRows={null}
        scrollContainerRef={scrollContainerRef}
        timestamp="2026-01-01T00:00:00.000Z"
        initiallyNearViewport
      >
        <span data-testid="row-content">content</span>
      </LazyMessageRow>
    </div>
  );
}

type RowBox = { top: number; height: number };

/**
 * The compensation only runs where the browser lacks scroll anchoring. jsdom
 * reports overflowAnchor as supported, so these tests delete it from the
 * style prototype to put the component on the WebKit path.
 */
const stylePrototype = Object.getPrototypeOf(document.documentElement.style) as Record<string, unknown>;
let overflowAnchorDescriptor: PropertyDescriptor | undefined;

function simulateMissingScrollAnchoring(): void {
  overflowAnchorDescriptor = Object.getOwnPropertyDescriptor(stylePrototype, 'overflowAnchor');
  delete stylePrototype.overflowAnchor;
}

function restoreScrollAnchoring(): void {
  if (overflowAnchorDescriptor) {
    Object.defineProperty(stylePrototype, 'overflowAnchor', overflowAnchorDescriptor);
    overflowAnchorDescriptor = undefined;
  }
}

/**
 * Renders the harness and wires the box model jsdom lacks: the container gets
 * a fixed viewport top and a stored scrollTop, the row gets a mutable rect.
 * The component's ResizeObserver baseline is the zero rect jsdom reports at
 * mount, so each test fires once to establish its starting height (a real
 * browser reports the laid-out height at observe time), then resets scrollTop
 * before the change under test.
 */
function setup(initialRowBox: RowBox, options: { scrollAnchoring?: boolean } = {}) {
  vi.stubGlobal('ResizeObserver', StubResizeObserver);
  if (!options.scrollAnchoring) simulateMissingScrollAnchoring();

  const { container } = render(<Harness />);
  const scroller = container.firstElementChild as HTMLElement;
  const row = scroller.querySelector('[data-message-timestamp]') as HTMLElement;
  const observer = StubResizeObserver.instances[StubResizeObserver.instances.length - 1];

  let scrollTop = 0;
  Object.defineProperty(scroller, 'scrollTop', {
    get: () => scrollTop,
    set: (next: number) => { scrollTop = next; },
    configurable: true,
  });
  scroller.getBoundingClientRect = () => ({ top: CONTAINER_TOP_PX, bottom: 900, width: 800 }) as DOMRect;

  const rowBox = { ...initialRowBox };
  row.getBoundingClientRect = () => ({
    width: 800,
    top: rowBox.top,
    bottom: rowBox.top + rowBox.height,
    height: rowBox.height,
  }) as DOMRect;

  // Baseline: adopt the initial height, then start the assertion from 0.
  // No observer exists where the browser's own anchoring makes this one moot.
  if (observer) fireResize(observer, row);
  scrollTop = 0;

  return {
    row,
    observer,
    setRowBox: (next: RowBox) => { rowBox.top = next.top; rowBox.height = next.height; },
    getScrollTop: () => scrollTop,
  };
}

afterEach(() => {
  StubResizeObserver.instances = [];
  vi.unstubAllGlobals();
  restoreScrollAnchoring();
});

describe('LazyMessageRow scroll anchoring', () => {
  it('shifts scrollTop by the delta when a row above the viewport grows', () => {
    const { row, observer, setRowBox, getScrollTop } = setup({ top: 50, height: 80 });

    setRowBox({ top: 50, height: 130 });
    fireResize(observer, row);

    expect(getScrollTop()).toBe(50);
  });

  it('shifts scrollTop back when a row above the viewport shrinks', () => {
    const { row, observer, setRowBox, getScrollTop } = setup({ top: 50, height: 130 });

    setRowBox({ top: 50, height: 90 });
    fireResize(observer, row);

    expect(getScrollTop()).toBe(-40);
  });

  it('leaves scrollTop alone when a row inside the viewport changes height', () => {
    const { row, observer, setRowBox, getScrollTop } = setup({ top: 300, height: 80 });

    setRowBox({ top: 300, height: 260 });
    fireResize(observer, row);

    expect(getScrollTop()).toBe(0);
  });

  it('leaves scrollTop alone when a row straddling the top edge grows', () => {
    // Bottom is at 250, already inside the viewport before the growth: the
    // visible part of this row does not move, so compensating would overshoot.
    const { row, observer, setRowBox, getScrollTop } = setup({ top: 150, height: 100 });

    setRowBox({ top: 150, height: 160 });
    fireResize(observer, row);

    expect(getScrollTop()).toBe(0);
  });

  it('ignores the zero rect of a hidden tab and keeps the height baseline', () => {
    const { row, observer, setRowBox, getScrollTop } = setup({ top: 50, height: 80 });

    const realRect = row.getBoundingClientRect;
    row.getBoundingClientRect = () => ({ width: 0, height: 0, top: 0, bottom: 0 }) as DOMRect;
    fireResize(observer, row);
    expect(getScrollTop()).toBe(0);

    // Back visible at the same height: no delta, because the zero rect did not
    // overwrite the baseline (a baseline of 0 would report a spurious +80 here).
    row.getBoundingClientRect = realRect;
    fireResize(observer, row);
    expect(getScrollTop()).toBe(0);

    setRowBox({ top: 50, height: 130 });
    fireResize(observer, row);
    expect(getScrollTop()).toBe(50);
  });

  it('leaves scroll anchoring to the browser where it is natively supported', () => {
    // Chrome path: no JS observer at all — stacking the emulation on the
    // native mechanism double-compensated every height change (visible drift).
    const { setRowBox, getScrollTop } = setup({ top: 50, height: 80 }, { scrollAnchoring: true });

    setRowBox({ top: 50, height: 130 });

    expect(StubResizeObserver.instances).toHaveLength(0);
    expect(getScrollTop()).toBe(0);
  });
});
