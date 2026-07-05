import assert from 'node:assert/strict';
import test from 'node:test';

import { clampSidebarWidth } from './sidebarWidth';

test('clamps sidebar width to supported desktop range', () => {
  assert.equal(clampSidebarWidth(100), 240);
  assert.equal(clampSidebarWidth(320), 320);
  assert.equal(clampSidebarWidth(900), 520);
});
