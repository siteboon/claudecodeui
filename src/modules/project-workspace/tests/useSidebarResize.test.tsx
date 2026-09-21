import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import { useSidebarResize } from '@/modules/project-workspace/hooks/useSidebarResize';

const STORAGE_KEY = 'sidebarWidth';
const DEFAULT_WIDTH = 288;
const MIN_WIDTH = 200;
const MAX_WIDTH = 600;
const ORIGINAL_INNER_WIDTH = window.innerWidth;

const setInnerWidth = (value: number) => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value });
};

const keyEvent = (key: string) => {
  let prevented = false;
  return {
    event: { key, preventDefault: () => { prevented = true; } } as unknown as ReactKeyboardEvent<HTMLDivElement>,
    wasPrevented: () => prevented,
  };
};

/**
 * jsdom has no pointer capture, so the drag tests hand the handlers a fake
 * `currentTarget` that records capture state the way a real element would.
 */
const pointerTarget = () => {
  let captured: number | null = null;
  return {
    setPointerCapture: (id: number) => { captured = id; },
    releasePointerCapture: () => { captured = null; },
    hasPointerCapture: (id: number) => captured === id,
  };
};

const pointerEvent = (
  currentTarget: ReturnType<typeof pointerTarget>,
  clientX: number,
  overrides: Partial<{ button: number }> = {},
) => ({
  button: 0,
  pointerId: 1,
  clientX,
  currentTarget,
  preventDefault: () => {},
  ...overrides,
}) as unknown as ReactPointerEvent<HTMLDivElement>;

beforeEach(() => {
  localStorage.clear();
  setInnerWidth(1440);
});

afterEach(() => {
  vi.unstubAllGlobals();
  setInnerWidth(ORIGINAL_INNER_WIDTH);
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
});

test('starts at the default width when nothing is stored', () => {
  const { result } = renderHook(() => useSidebarResize());
  assert.equal(result.current.sidebarWidth, DEFAULT_WIDTH);
  assert.equal(result.current.isResizing, false);
  assert.equal(result.current.minWidth, MIN_WIDTH);
  assert.equal(result.current.maxWidth, MAX_WIDTH);
});

test('honours a stored width', () => {
  localStorage.setItem(STORAGE_KEY, '420');
  const { result } = renderHook(() => useSidebarResize());
  assert.equal(result.current.sidebarWidth, 420);
});

test('ignores a corrupt stored value and clears it', () => {
  localStorage.setItem(STORAGE_KEY, 'not-a-number');
  const { result } = renderHook(() => useSidebarResize());
  assert.equal(result.current.sidebarWidth, DEFAULT_WIDTH);
  assert.equal(localStorage.getItem(STORAGE_KEY), null);
});

test('clamps a stored width to the min and max on load', () => {
  localStorage.setItem(STORAGE_KEY, '50');
  assert.equal(renderHook(() => useSidebarResize()).result.current.sidebarWidth, MIN_WIDTH);

  localStorage.setItem(STORAGE_KEY, '5000');
  assert.equal(renderHook(() => useSidebarResize()).result.current.sidebarWidth, MAX_WIDTH);
});

test('never leaves the main pane narrower than 400px', () => {
  setInnerWidth(700);
  localStorage.setItem(STORAGE_KEY, '500');
  const { result } = renderHook(() => useSidebarResize());
  assert.equal(result.current.sidebarWidth, 300);
  assert.equal(result.current.maxWidth, 300, 'the announced max is the effective one');

  // End jumps to the effective max, not the absolute one.
  act(() => {
    result.current.handleProps.onKeyDown(keyEvent('End').event);
  });
  assert.equal(result.current.sidebarWidth, 300);
});

test('re-clamps when the window shrinks and restores the choice when it grows back', () => {
  localStorage.setItem(STORAGE_KEY, '550');
  const { result } = renderHook(() => useSidebarResize());
  assert.equal(result.current.sidebarWidth, 550);

  act(() => {
    setInnerWidth(800);
    window.dispatchEvent(new Event('resize'));
  });
  assert.equal(result.current.sidebarWidth, 400);
  assert.equal(result.current.maxWidth, 400);
  // The stored preference survives so a larger screen still restores it.
  assert.equal(localStorage.getItem(STORAGE_KEY), '550');

  // Keys step from the rendered width, not the capped-away preference.
  act(() => {
    result.current.handleProps.onKeyDown(keyEvent('ArrowLeft').event);
  });
  assert.equal(result.current.sidebarWidth, 384);
  assert.equal(localStorage.getItem(STORAGE_KEY), '384');

  act(() => {
    setInnerWidth(1440);
    window.dispatchEvent(new Event('resize'));
  });
  assert.equal(result.current.sidebarWidth, 384);
  assert.equal(result.current.maxWidth, MAX_WIDTH);
});

test('growing the window back restores a width that was only viewport-capped', () => {
  localStorage.setItem(STORAGE_KEY, '520');
  setInnerWidth(800);
  const { result } = renderHook(() => useSidebarResize());
  assert.equal(result.current.sidebarWidth, 400);

  act(() => {
    setInnerWidth(1440);
    window.dispatchEvent(new Event('resize'));
  });
  assert.equal(result.current.sidebarWidth, 520);
  assert.equal(localStorage.getItem(STORAGE_KEY), '520');
});

test('falls back to the default when storage is unavailable', () => {
  const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('SecurityError');
  });
  const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('SecurityError');
  });
  const { result } = renderHook(() => useSidebarResize());
  assert.equal(result.current.sidebarWidth, DEFAULT_WIDTH);

  act(() => {
    result.current.handleProps.onKeyDown(keyEvent('ArrowRight').event);
  });
  assert.equal(result.current.sidebarWidth, DEFAULT_WIDTH + 16, 'the width still applies in memory');
  getItem.mockRestore();
  setItem.mockRestore();
});

test('arrow keys step by 16px, Home/End jump to the bounds, and each change persists', () => {
  const { result } = renderHook(() => useSidebarResize());

  const right = keyEvent('ArrowRight');
  act(() => {
    result.current.handleProps.onKeyDown(right.event);
  });
  assert.equal(result.current.sidebarWidth, DEFAULT_WIDTH + 16);
  assert.equal(right.wasPrevented(), true);
  assert.equal(localStorage.getItem(STORAGE_KEY), String(DEFAULT_WIDTH + 16));

  act(() => {
    result.current.handleProps.onKeyDown(keyEvent('ArrowLeft').event);
    result.current.handleProps.onKeyDown(keyEvent('ArrowLeft').event);
  });
  assert.equal(result.current.sidebarWidth, DEFAULT_WIDTH - 16);

  act(() => {
    result.current.handleProps.onKeyDown(keyEvent('Home').event);
  });
  assert.equal(result.current.sidebarWidth, MIN_WIDTH);

  act(() => {
    result.current.handleProps.onKeyDown(keyEvent('ArrowLeft').event);
  });
  assert.equal(result.current.sidebarWidth, MIN_WIDTH, 'cannot step below the minimum');

  act(() => {
    result.current.handleProps.onKeyDown(keyEvent('End').event);
  });
  assert.equal(result.current.sidebarWidth, MAX_WIDTH);
  assert.equal(localStorage.getItem(STORAGE_KEY), String(MAX_WIDTH));

  const other = keyEvent('Enter');
  act(() => {
    result.current.handleProps.onKeyDown(other.event);
  });
  assert.equal(result.current.sidebarWidth, MAX_WIDTH);
  assert.equal(other.wasPrevented(), false, 'unrelated keys are left alone');
});

test('double-click resets to the default width and persists it', () => {
  localStorage.setItem(STORAGE_KEY, '500');
  const { result } = renderHook(() => useSidebarResize());
  assert.equal(result.current.sidebarWidth, 500);

  act(() => {
    result.current.handleProps.onDoubleClick();
  });
  assert.equal(result.current.sidebarWidth, DEFAULT_WIDTH);
  assert.equal(localStorage.getItem(STORAGE_KEY), String(DEFAULT_WIDTH));
});

test('a pointer drag coalesces moves per frame, clamps, and persists once on release', () => {
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});

  const { result } = renderHook(() => useSidebarResize());
  const container = document.createElement('div');
  container.getBoundingClientRect = () => ({ left: 0 } as DOMRect);
  result.current.containerRef.current = container;
  const target = pointerTarget();

  // Grabbing 3px inside the handle's right edge keeps that offset while dragging.
  act(() => {
    result.current.handleProps.onPointerDown(pointerEvent(target, 285));
  });
  assert.equal(result.current.isResizing, true);
  assert.equal(document.body.style.cursor, 'col-resize');
  assert.equal(document.body.style.userSelect, 'none');

  act(() => {
    result.current.handleProps.onPointerMove(pointerEvent(target, 350));
    result.current.handleProps.onPointerMove(pointerEvent(target, 417));
  });
  assert.equal(frames.length, 1, 'several moves in one frame schedule a single commit');
  assert.equal(result.current.sidebarWidth, DEFAULT_WIDTH, 'nothing commits before the frame');

  act(() => {
    frames[0](0);
  });
  assert.equal(result.current.sidebarWidth, 420);
  assert.equal(localStorage.getItem(STORAGE_KEY), null, 'not persisted per frame');

  // A move past the max lands on the max, and the last move wins on release
  // even when its frame never ran.
  act(() => {
    result.current.handleProps.onPointerMove(pointerEvent(target, 900));
    result.current.handleProps.onPointerUp(pointerEvent(target, 900));
  });
  assert.equal(result.current.sidebarWidth, MAX_WIDTH);
  assert.equal(result.current.isResizing, false);
  assert.equal(document.body.style.cursor, '');
  assert.equal(document.body.style.userSelect, '');
  assert.equal(localStorage.getItem(STORAGE_KEY), String(MAX_WIDTH));
});

test('a release that never reaches the handle still ends the drag', () => {
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => {});

  const { result } = renderHook(() => useSidebarResize());
  const container = document.createElement('div');
  container.getBoundingClientRect = () => ({ left: 0 } as DOMRect);
  result.current.containerRef.current = container;
  const target = pointerTarget();

  act(() => {
    result.current.handleProps.onPointerDown(pointerEvent(target, 288));
    result.current.handleProps.onPointerMove(pointerEvent(target, 360));
  });
  assert.equal(result.current.isResizing, true);

  // The handle unmounted mid-drag (capture dropped), so the pointerup lands on
  // whatever is under the pointer and only bubbles to the window.
  act(() => {
    window.dispatchEvent(new Event('pointerup', { bubbles: true }));
  });
  assert.equal(result.current.isResizing, false);
  assert.equal(result.current.sidebarWidth, 360, 'the last pending position still lands');
  assert.equal(document.body.style.cursor, '');
  assert.equal(document.body.style.userSelect, '');
  assert.equal(localStorage.getItem(STORAGE_KEY), '360');
});

test('a secondary button press and uncaptured moves are ignored', () => {
  const { result } = renderHook(() => useSidebarResize());
  const target = pointerTarget();

  act(() => {
    result.current.handleProps.onPointerDown(pointerEvent(target, 288, { button: 2 }));
    result.current.handleProps.onPointerMove(pointerEvent(target, 500));
    result.current.handleProps.onPointerUp(pointerEvent(target, 500));
  });
  assert.equal(result.current.isResizing, false);
  assert.equal(result.current.sidebarWidth, DEFAULT_WIDTH);
  assert.equal(localStorage.getItem(STORAGE_KEY), null);
});
