import type { Terminal } from '@xterm/xterm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installMobileTerminalSelection } from '@/modules/shell/utils/mobileTerminalSelection';

const LINE_HEIGHT = 20;

/** A terminal element with a viewport that does or does not have scrollback. */
function createTerminal(hasScrollback: boolean) {
  const element = document.createElement('div');
  const viewport = document.createElement('div');
  viewport.className = 'xterm-viewport';
  Object.defineProperty(viewport, 'clientHeight', { value: 480 });
  Object.defineProperty(viewport, 'scrollHeight', { value: hasScrollback ? 2000 : 480 });
  element.appendChild(viewport);
  const content = document.createElement('div');
  content.appendChild(element);
  document.body.appendChild(content);

  const disposable = { dispose: () => undefined };
  const terminal = {
    element,
    rows: 24,
    cols: 80,
    options: { fontSize: 14 },
    buffer: { active: { viewportY: 0 } },
    onSelectionChange: () => disposable,
    onResize: () => disposable,
    onScroll: () => disposable,
    hasSelection: () => false,
    clearSelection: () => undefined,
    refresh: () => undefined,
    _core: { _renderService: { dimensions: { css: { cell: { width: 8, height: LINE_HEIGHT } } } } },
  } as unknown as Terminal;

  const wheelDeltas: number[] = [];
  element.addEventListener('wheel', (event) => wheelDeltas.push((event as WheelEvent).deltaY));
  const manager = installMobileTerminalSelection(terminal, content);
  return { element, wheelDeltas, manager, content };
}

function touch(target: HTMLElement, type: string, y: number | null) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  const touches = y === null ? [] : [{ clientX: 100, clientY: y }];
  Object.defineProperty(event, 'touches', { value: touches });
  Object.defineProperty(event, 'changedTouches', { value: touches });
  target.dispatchEvent(event);
  return event;
}

/** Drags one finger from `fromY` to `toY` in 10 px steps, 8 ms apart. */
function drag(target: HTMLElement, fromY: number, toY: number) {
  touch(target, 'touchstart', fromY);
  const step = toY > fromY ? 10 : -10;
  let prevented = true;
  for (let y = fromY + step; step > 0 ? y <= toY : y >= toY; y += step) {
    vi.advanceTimersByTime(8);
    prevented = touch(target, 'touchmove', y).defaultPrevented && prevented;
  }
  return prevented;
}

describe('one-finger scrolling on a full-screen terminal program', () => {
  let cleanup: Array<() => void> = [];

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
    // The manager only installs on touch devices.
    Object.defineProperty(navigator, 'maxTouchPoints', { value: 5, configurable: true });
  });

  afterEach(() => {
    cleanup.forEach((run) => run());
    cleanup = [];
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  const setup = (hasScrollback: boolean) => {
    const view = createTerminal(hasScrollback);
    cleanup.push(() => view.manager?.dispose());
    return view;
  };

  it('sends one wheel step per line of finger travel when there is no scrollback', () => {
    const { element, wheelDeltas } = setup(false);

    const prevented = drag(element, 400, 200);
    touch(element, 'touchcancel', null);

    expect(prevented).toBe(true);
    expect(wheelDeltas).toEqual(Array(10).fill(1));
  });

  it('scrolls back towards earlier output when the finger moves down', () => {
    const { element, wheelDeltas } = setup(false);

    drag(element, 200, 300);
    touch(element, 'touchcancel', null);

    expect(wheelDeltas).toEqual(Array(5).fill(-1));
  });

  it('keeps coasting through the wheel after a quick flick', () => {
    const { element, wheelDeltas } = setup(false);

    drag(element, 400, 200);
    touch(element, 'touchend', null);
    const afterDrag = wheelDeltas.length;
    vi.advanceTimersByTime(2000);

    expect(wheelDeltas.length).toBeGreaterThan(afterDrag);
    expect(new Set(wheelDeltas)).toEqual(new Set([1]));
  });

  it('leaves a terminal with its own scrollback to xterm', () => {
    const { element, wheelDeltas } = setup(true);

    const prevented = drag(element, 400, 200);
    touch(element, 'touchcancel', null);

    expect(prevented).toBe(false);
    expect(wheelDeltas).toEqual([]);
  });

  it('does not scroll on a tap', () => {
    const { element, wheelDeltas } = setup(false);

    touch(element, 'touchstart', 300);
    touch(element, 'touchmove', 303);
    touch(element, 'touchend', null);
    vi.advanceTimersByTime(2000);

    expect(wheelDeltas).toEqual([]);
  });
});
