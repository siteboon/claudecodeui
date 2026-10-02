import type { Terminal } from '@xterm/xterm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installMobileTerminalSelection } from '@/modules/shell/utils/mobileTerminalSelection';

type ScreenState = {
  mouseTrackingMode: 'none' | 'x10' | 'vt200' | 'drag' | 'any';
  bufferType: 'normal' | 'alternate';
};

// Only the surface the touch layer reads: the rendered element tree, the
// mouse-tracking mode, the active buffer and the event subscriptions.
function createTerminal({ mouseTrackingMode, bufferType }: ScreenState) {
  const element = document.createElement('div');
  element.className = 'xterm';
  const viewport = document.createElement('div');
  viewport.className = 'xterm-viewport';
  const screen = document.createElement('div');
  screen.className = 'xterm-screen';
  element.append(viewport, screen);

  const container = document.createElement('div');
  container.appendChild(element);
  document.body.appendChild(container);

  const subscription = () => ({ dispose: () => {} });
  const terminal = {
    element,
    cols: 80,
    rows: 24,
    options: { fontSize: 14 },
    modes: { mouseTrackingMode },
    buffer: { active: { type: bufferType } },
    hasSelection: () => false,
    onSelectionChange: subscription,
    onResize: subscription,
    onScroll: subscription,
  } as unknown as Terminal;

  const wheels: number[] = [];
  screen.addEventListener('wheel', (event) => wheels.push((event as WheelEvent).deltaY));

  return { terminal, container, element, wheels };
}

function touch(target: HTMLElement, type: string, clientY: number | null): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  const touches = clientY === null ? [] : [{ clientX: 100, clientY }];
  Object.defineProperty(event, 'touches', { value: touches });
  target.dispatchEvent(event);
  return event;
}

describe('mobile terminal scrolling', () => {
  let now = 0;
  let frames: FrameRequestCallback[] = [];

  beforeEach(() => {
    now = 1000;
    frames = [];
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  // Runs queued animation frames, 16 ms apart, until the glide stops.
  function runFrames(limit = 500) {
    for (let i = 0; i < limit && frames.length > 0; i++) {
      const callback = frames.shift()!;
      now += 16;
      callback(now);
    }
  }

  function drag(element: HTMLElement, ys: number[]) {
    touch(element, 'touchstart', ys[0]);
    const moves = ys.slice(1).map((y) => {
      now += 16;
      return touch(element, 'touchmove', y);
    });
    touch(element, 'touchend', null);
    return moves;
  }

  it('turns a drag into wheel events while the app has mouse reporting on', () => {
    const { terminal, container, element, wheels } = createTerminal({
      mouseTrackingMode: 'any',
      bufferType: 'alternate',
    });
    const manager = installMobileTerminalSelection(terminal, container);

    const moves = drag(element, [300, 280, 250]);

    // Finger moving up scrolls the content down, like a wheel turned towards you.
    expect(wheels).toEqual([20, 30]);
    expect(moves.every((event) => event.defaultPrevented)).toBe(true);
    manager?.dispose();
  });

  it('forwards the drag on the alternate screen without mouse reporting too', () => {
    const { terminal, container, element, wheels } = createTerminal({
      mouseTrackingMode: 'none',
      bufferType: 'alternate',
    });
    const manager = installMobileTerminalSelection(terminal, container);

    drag(element, [200, 240]);

    expect(wheels).toEqual([-40]);
    manager?.dispose();
  });

  it('keeps gliding with decaying wheel events after a flick', () => {
    const { terminal, container, element, wheels } = createTerminal({
      mouseTrackingMode: 'vt200',
      bufferType: 'alternate',
    });
    const manager = installMobileTerminalSelection(terminal, container);

    drag(element, [400, 360, 320]);
    const duringDrag = wheels.length;
    runFrames();

    const glide = wheels.slice(duringDrag);
    expect(glide.length).toBeGreaterThan(5);
    expect(glide.every((delta) => delta > 0)).toBe(true);
    expect(glide[glide.length - 1]).toBeLessThan(glide[0]);
    manager?.dispose();
  });

  it('leaves a plain shell on the normal buffer to xterm', () => {
    const { terminal, container, element, wheels } = createTerminal({
      mouseTrackingMode: 'none',
      bufferType: 'normal',
    });
    const manager = installMobileTerminalSelection(terminal, container);

    const moves = drag(element, [300, 280, 250]);

    expect(wheels).toEqual([]);
    expect(moves.some((event) => event.defaultPrevented)).toBe(false);
    manager?.dispose();
  });
});
