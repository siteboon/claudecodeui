import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COLLAPSED_SIDEBAR_WIDTH,
  DESKTOP_MAIN_MIN_WIDTH,
  clampSidebarWidth,
  getDesktopSidebarWidth,
} from './sidebarWidth';

test('clamps sidebar width to supported desktop range', () => {
  assert.equal(clampSidebarWidth(100), 240);
  assert.equal(clampSidebarWidth(320), 320);
  assert.equal(clampSidebarWidth(900), 520);
});

test('uses compact rail width when desktop sidebar is hidden', () => {
  assert.equal(getDesktopSidebarWidth(320, false), COLLAPSED_SIDEBAR_WIDTH);
});

test('keeps enough desktop width reserved for the main window', () => {
  assert.equal(DESKTOP_MAIN_MIN_WIDTH, 360);
});
