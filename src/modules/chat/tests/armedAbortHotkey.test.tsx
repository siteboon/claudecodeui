import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import { useArmedAbortHotkey } from '@/modules/chat/hooks/useArmedAbortHotkey';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function pressEscape(init: KeyboardEventInit = {}, target: EventTarget = document) {
  const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

test('a single Escape arms the abort without performing it', () => {
  const onAbort = vi.fn();
  const { result } = renderHook(() => useArmedAbortHotkey({ enabled: true, onAbort }));

  pressEscape();

  assert.equal(result.current, true);
  assert.equal(onAbort.mock.calls.length, 0);
});

test('a second Escape inside the window aborts', () => {
  const onAbort = vi.fn();
  const { result } = renderHook(() => useArmedAbortHotkey({ enabled: true, onAbort, armWindowMs: 2500 }));

  pressEscape();
  act(() => {
    vi.advanceTimersByTime(1000);
  });
  pressEscape();

  assert.equal(onAbort.mock.calls.length, 1);
  assert.equal(result.current, false);
});

test('arming lapses once the window passes, so a later Escape starts over', () => {
  const onAbort = vi.fn();
  const { result } = renderHook(() => useArmedAbortHotkey({ enabled: true, onAbort, armWindowMs: 2500 }));

  pressEscape();
  act(() => {
    vi.advanceTimersByTime(2600);
  });
  assert.equal(result.current, false);

  pressEscape();

  assert.equal(onAbort.mock.calls.length, 0);
  assert.equal(result.current, true);
});

// The bug this hook was written for: the listener ran in the capture phase on
// `document`, so it fired before the `@file` and `/command` popups — which call
// preventDefault() on Escape — could protect the turn they sat on top of.
//
// The popup handler goes on a nested node, as React's do on the `#root` mount,
// so the bubble order here is the one the browser actually produces.
test('an Escape already handled by a popup neither arms nor aborts', () => {
  const onAbort = vi.fn();
  const { result } = renderHook(() => useArmedAbortHotkey({ enabled: true, onAbort }));

  const popup = document.createElement('div');
  document.body.appendChild(popup);
  popup.addEventListener('keydown', (event) => {
    if ((event as KeyboardEvent).key === 'Escape') event.preventDefault();
  });

  try {
    pressEscape({}, popup);
  } finally {
    popup.remove();
  }

  assert.equal(result.current, false);
  assert.equal(onAbort.mock.calls.length, 0);
});

test('key repeat from a held Escape cannot supply the second press', () => {
  const onAbort = vi.fn();
  renderHook(() => useArmedAbortHotkey({ enabled: true, onAbort }));

  pressEscape();
  pressEscape({ repeat: true });

  assert.equal(onAbort.mock.calls.length, 0);
});

test('no turn to stop means Escape is ignored entirely', () => {
  const onAbort = vi.fn();
  const { result } = renderHook(() => useArmedAbortHotkey({ enabled: false, onAbort }));

  const event = pressEscape();

  assert.equal(result.current, false);
  assert.equal(onAbort.mock.calls.length, 0);
  assert.equal(event.defaultPrevented, false);
});

test('arming does not survive the turn ending', () => {
  const onAbort = vi.fn();
  const { result, rerender } = renderHook(
    ({ enabled }) => useArmedAbortHotkey({ enabled, onAbort }),
    { initialProps: { enabled: true } },
  );

  pressEscape();
  assert.equal(result.current, true);

  rerender({ enabled: false });
  assert.equal(result.current, false);
});
