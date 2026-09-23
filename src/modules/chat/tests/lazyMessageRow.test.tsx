import { afterEach, describe, expect, it, vi } from 'vitest';
import React, { useRef } from 'react';
import type { ReactNode } from 'react';
import { act, render } from '@testing-library/react';

import { useLazyRowObserver } from '@/modules/chat/hooks/useLazyRowObserver';
import LazyMessageRow from '@/modules/chat/transcript/LazyMessageRow';

/**
 * Drivable IntersectionObserver stand-in: jsdom has none, so these tests
 * install one and fire its callback by hand to walk a row through the
 * near-viewport / far-away transitions.
 */
class StubIntersectionObserver {
  static instances: StubIntersectionObserver[] = [];

  callback: IntersectionObserverCallback;
  observed: Element[] = [];

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    StubIntersectionObserver.instances.push(this);
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

function fireIntersection(
  observer: StubIntersectionObserver,
  target: Element,
  isIntersecting: boolean,
  rect: { width: number; height: number } = { width: 100, height: 40 },
): void {
  act(() => {
    observer.callback(
      [{ target, isIntersecting, boundingClientRect: rect } as IntersectionObserverEntry],
      observer as unknown as IntersectionObserver,
    );
  });
}

function Harness({
  initiallyNearViewport,
  content = <span data-testid="row-content">expensive content</span>,
}: {
  initiallyNearViewport: boolean;
  content?: ReactNode;
}) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const lazyRows = useLazyRowObserver(scrollContainerRef);
  return (
    <div ref={scrollContainerRef}>
      <LazyMessageRow
        lazyRows={lazyRows}
        timestamp="2026-01-01T00:00:00.000Z"
        initiallyNearViewport={initiallyNearViewport}
      >
        {content}
      </LazyMessageRow>
    </div>
  );
}

/**
 * Gives the wrapper the box a browser would lay out: the placeholder's inline
 * height while unmounted, the content's height while mounted. jsdom has no
 * layout, so both readings the component could take (the exact rect and the
 * integer-rounded offsetHeight) are derived from that one model.
 */
function modelRowLayout(wrapper: HTMLElement, contentHeight: number): () => number {
  const currentHeight = () => (wrapper.style.height === '' ? contentHeight : parseFloat(wrapper.style.height));
  Object.defineProperty(wrapper, 'offsetHeight', { get: () => Math.round(currentHeight()), configurable: true });
  wrapper.getBoundingClientRect = () => ({ width: 800, height: currentHeight() }) as DOMRect;
  return currentHeight;
}

/**
 * Plays the observer the way a browser does for a row just above the band
 * (viewport top - rootMargin): the row's top edge is fixed, as it is in Safari,
 * which has no scroll anchoring to move it, so the row counts as near exactly
 * while its bottom edge reaches the band. Reports every change until the state
 * stops changing; returns how many it took, or `maxReports` if it never settled.
 */
function playBandEdge(
  observer: StubIntersectionObserver,
  wrapper: HTMLElement,
  currentHeight: () => number,
  topBelowBandEdgePx: number,
  maxReports = 20,
): number {
  let reported: boolean | null = null;
  for (let reports = 0; reports < maxReports; reports += 1) {
    const isNear = topBelowBandEdgePx + currentHeight() >= 0;
    if (isNear === reported) return reports;
    reported = isNear;
    fireIntersection(observer, wrapper, isNear, { width: 800, height: currentHeight() });
  }
  return maxReports;
}

afterEach(() => {
  StubIntersectionObserver.instances = [];
  vi.unstubAllGlobals();
});

describe('LazyMessageRow', () => {
  it('starts far rows as an addressable placeholder instead of mounting content', () => {
    vi.stubGlobal('IntersectionObserver', StubIntersectionObserver);

    const { container, queryByTestId } = render(<Harness initiallyNearViewport={false} />);

    expect(queryByTestId('row-content')).toBeNull();
    const wrapper = container.querySelector('[data-message-timestamp="2026-01-01T00:00:00.000Z"]');
    expect(wrapper).not.toBeNull();
    expect((wrapper as HTMLElement).style.height).not.toBe('');
  });

  it('unmounts to a placeholder of the measured height and remounts when near again', () => {
    vi.stubGlobal('IntersectionObserver', StubIntersectionObserver);

    const { queryByTestId } = render(<Harness initiallyNearViewport />);
    expect(queryByTestId('row-content')).not.toBeNull();

    const observer = StubIntersectionObserver.instances[0];
    const wrapper = observer.observed[0] as HTMLElement;
    modelRowLayout(wrapper, 123.5);

    fireIntersection(observer, wrapper, false);
    expect(queryByTestId('row-content')).toBeNull();
    // The exact height, not offsetHeight's rounded 124.
    expect(wrapper.style.height).toBe('123.5px');

    fireIntersection(observer, wrapper, true);
    expect(queryByTestId('row-content')).not.toBeNull();
    expect(wrapper.style.height).toBe('');
  });

  it('keeps a row whose content renders nothing at 0px once it leaves the band', () => {
    vi.stubGlobal('IntersectionObserver', StubIntersectionObserver);

    render(<Harness initiallyNearViewport content={null} />);
    const observer = StubIntersectionObserver.instances[0];
    const wrapper = observer.observed[0] as HTMLElement;
    modelRowLayout(wrapper, 0);

    fireIntersection(observer, wrapper, false, { width: 800, height: 0 });

    // Not the 100px estimate: that would be taller than what it replaces.
    expect(wrapper.style.height).toBe('0px');
  });

  it('settles instead of flickering when an empty row sits just past the band edge', () => {
    vi.stubGlobal('IntersectionObserver', StubIntersectionObserver);

    // A never-measured placeholder (100px estimate) whose top is 50px above the
    // band: its bottom reaches in, so it mounts; its content is 0px, so it leaves.
    render(<Harness initiallyNearViewport={false} content={null} />);
    const observer = StubIntersectionObserver.instances[0];
    const wrapper = observer.observed[0] as HTMLElement;
    const currentHeight = modelRowLayout(wrapper, 0);

    const reports = playBandEdge(observer, wrapper, currentHeight, -50);

    expect(reports).toBeLessThan(20);
    expect(wrapper.style.height).toBe('0px');
  });

  it('settles instead of flickering when a fractional-height row sits just past the band edge', () => {
    vi.stubGlobal('IntersectionObserver', StubIntersectionObserver);

    // 99.6px of content, top 99.8px above the band: the content's bottom is
    // outside it, but a placeholder rounded up to 100px would be inside.
    const { queryByTestId } = render(<Harness initiallyNearViewport />);
    const observer = StubIntersectionObserver.instances[0];
    const wrapper = observer.observed[0] as HTMLElement;
    const currentHeight = modelRowLayout(wrapper, 99.6);

    const reports = playBandEdge(observer, wrapper, currentHeight, -99.8);

    expect(reports).toBeLessThan(20);
    expect(queryByTestId('row-content')).toBeNull();
    expect(wrapper.style.height).toBe('99.6px');
  });

  it('ignores the zero-rect non-intersections a hidden tab reports', () => {
    vi.stubGlobal('IntersectionObserver', StubIntersectionObserver);

    const { queryByTestId } = render(<Harness initiallyNearViewport />);
    const observer = StubIntersectionObserver.instances[0];
    const wrapper = observer.observed[0] as HTMLElement;

    fireIntersection(observer, wrapper, false, { width: 0, height: 0 });

    expect(queryByTestId('row-content')).not.toBeNull();
  });

  it('keeps the last measured height when the row has no box as it leaves', () => {
    vi.stubGlobal('IntersectionObserver', StubIntersectionObserver);

    render(<Harness initiallyNearViewport />);
    const observer = StubIntersectionObserver.instances[0];
    const wrapper = observer.observed[0] as HTMLElement;
    modelRowLayout(wrapper, 123.5);

    fireIntersection(observer, wrapper, false);
    fireIntersection(observer, wrapper, true);
    // The wrapper itself is not laid out (0x0) by the time the exit arrives.
    wrapper.getBoundingClientRect = () => ({ width: 0, height: 0 }) as DOMRect;
    fireIntersection(observer, wrapper, false);

    // A 0x0 box says nothing about the row's height; 0px would collapse it.
    expect(wrapper.style.height).toBe('123.5px');
  });

  it('keeps every row mounted where IntersectionObserver does not exist', () => {
    const { queryByTestId } = render(<Harness initiallyNearViewport={false} />);

    expect(queryByTestId('row-content')).not.toBeNull();
    expect(StubIntersectionObserver.instances).toHaveLength(0);
  });
});
