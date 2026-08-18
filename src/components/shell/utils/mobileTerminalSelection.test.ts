import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveTerminalTouchAction,
  touchMoveExceedsThreshold,
} from './mobileTerminalSelection';

test('resolveTerminalTouchAction lets the compositor scroll when idle', () => {
  assert.equal(
    resolveTerminalTouchAction({
      isSelecting: false,
      isHandleDragging: false,
      isPinching: false,
    }),
    'pan-y',
  );
});

test('resolveTerminalTouchAction disables scrolling while selecting text', () => {
  assert.equal(
    resolveTerminalTouchAction({
      isSelecting: true,
      isHandleDragging: false,
      isPinching: false,
    }),
    'none',
  );
});

test('resolveTerminalTouchAction disables scrolling while dragging a selection handle', () => {
  assert.equal(
    resolveTerminalTouchAction({
      isSelecting: false,
      isHandleDragging: true,
      isPinching: false,
    }),
    'none',
  );
});

test('resolveTerminalTouchAction disables scrolling while pinch-zooming', () => {
  assert.equal(
    resolveTerminalTouchAction({
      isSelecting: false,
      isHandleDragging: false,
      isPinching: true,
    }),
    'none',
  );
});

test('resolveTerminalTouchAction stays none when several gestures overlap', () => {
  assert.equal(
    resolveTerminalTouchAction({
      isSelecting: true,
      isHandleDragging: true,
      isPinching: true,
    }),
    'none',
  );
});

test('touchMoveExceedsThreshold is false for a stationary touch', () => {
  const point = { clientX: 100, clientY: 200 };
  assert.equal(touchMoveExceedsThreshold(point, point, 8), false);
});

test('touchMoveExceedsThreshold is false exactly at the threshold (strict >)', () => {
  const origin = { clientX: 0, clientY: 0 };
  const current = { clientX: 8, clientY: 0 };
  assert.equal(touchMoveExceedsThreshold(origin, current, 8), false);
});

test('touchMoveExceedsThreshold is true just past the threshold', () => {
  const origin = { clientX: 0, clientY: 0 };
  const current = { clientX: 9, clientY: 0 };
  assert.equal(touchMoveExceedsThreshold(origin, current, 8), true);
});

test('touchMoveExceedsThreshold measures euclidean distance, not per-axis', () => {
  const origin = { clientX: 0, clientY: 0 };
  // (6, 6) -> hypot ≈ 8.49, which exceeds 8 even though neither axis alone does.
  const current = { clientX: 6, clientY: 6 };
  assert.equal(touchMoveExceedsThreshold(origin, current, 8), true);
});

test('touchMoveExceedsThreshold handles vertical scroll drags', () => {
  const origin = { clientX: 40, clientY: 300 };
  const current = { clientX: 40, clientY: 260 };
  assert.equal(touchMoveExceedsThreshold(origin, current, 8), true);
});
