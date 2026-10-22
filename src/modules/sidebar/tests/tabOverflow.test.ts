import assert from 'node:assert/strict';

import { test } from 'vitest';

import { fitTabsInRow } from '@/modules/sidebar/hooks/useTabOverflow';

/**
 * The sidebar can be dragged down to 220px, which is narrower than the section
 * strip. These cover what the strip keeps in the row at a given width; the
 * measuring itself needs a laid-out DOM and is not exercised here.
 */

// Projects, Conversations, Running, Archive, roughly at their rendered widths.
const WIDTHS = [88, 124, 30, 32];
const TRIGGER_WIDTH = 30;

test('keeps every tab when the row is wide enough', () => {
  const visible = fitTabsInRow({ widths: WIDTHS, triggerWidth: TRIGGER_WIDTH, available: 300, activeIndex: 0 });

  assert.deepEqual(visible, [0, 1, 2, 3]);
});

test('keeps a strip that fits to the pixel, and one that misses by a rounding error', () => {
  const exact = fitTabsInRow({ widths: WIDTHS, triggerWidth: TRIGGER_WIDTH, available: 274, activeIndex: 0 });
  const rounded = fitTabsInRow({ widths: WIDTHS, triggerWidth: TRIGGER_WIDTH, available: 273.8, activeIndex: 0 });

  assert.deepEqual(exact, [0, 1, 2, 3]);
  assert.deepEqual(rounded, [0, 1, 2, 3]);
});

test('drops the tabs past the fold, leaving room for the overflow trigger', () => {
  const visible = fitTabsInRow({ widths: WIDTHS, triggerWidth: TRIGGER_WIDTH, available: 200, activeIndex: 0 });

  // 88 + 30 for the trigger fits in 200; adding Conversations would not.
  assert.deepEqual(visible, [0]);
});

test('keeps the active tab in the row even when it is past the fold', () => {
  const visible = fitTabsInRow({ widths: WIDTHS, triggerWidth: TRIGGER_WIDTH, available: 200, activeIndex: 3 });

  // Archive is pinned and Projects fills what is left: 88 + 32 + 30 <= 200.
  assert.deepEqual(visible, [0, 3]);
});

test('shows the active tab alone when nothing else fits beside it', () => {
  const visible = fitTabsInRow({ widths: WIDTHS, triggerWidth: TRIGGER_WIDTH, available: 160, activeIndex: 1 });

  assert.deepEqual(visible, [1]);
});

test('drops from the left onwards rather than picking out whichever tabs fit', () => {
  const visible = fitTabsInRow({ widths: [124, 30, 30, 30], triggerWidth: TRIGGER_WIDTH, available: 120, activeIndex: -1 });

  // The narrow tabs would each fit on their own, but a strip with a hole in it
  // reads as broken — the row stops at the first tab that does not fit.
  assert.deepEqual(visible, []);
});
