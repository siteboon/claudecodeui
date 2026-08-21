import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  clampSidebarWidth,
  parseSidebarWidth,
} from './useSidebarWidth';

test('the sidebar width is clamped to the supported range', () => {
  assert.equal(clampSidebarWidth(SIDEBAR_WIDTH_MIN - 100), SIDEBAR_WIDTH_MIN);
  assert.equal(clampSidebarWidth(SIDEBAR_WIDTH_MAX + 100), SIDEBAR_WIDTH_MAX);
  assert.equal(clampSidebarWidth(320), 320);
  assert.equal(clampSidebarWidth(320.6), 321);
});

test('a stored width is restored, and a broken one falls back to the default', () => {
  assert.equal(parseSidebarWidth('420'), 420);
  assert.equal(parseSidebarWidth('9999'), SIDEBAR_WIDTH_MAX);
  assert.equal(parseSidebarWidth('10'), SIDEBAR_WIDTH_MIN);
  assert.equal(parseSidebarWidth(null), SIDEBAR_WIDTH_DEFAULT);
  assert.equal(parseSidebarWidth('wide, please'), SIDEBAR_WIDTH_DEFAULT);
  assert.equal(parseSidebarWidth(undefined), SIDEBAR_WIDTH_DEFAULT);
});

test('the default width matches the previous fixed sidebar', () => {
  assert.equal(SIDEBAR_WIDTH_DEFAULT, 288); // md:w-72
});
