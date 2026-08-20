import assert from 'node:assert/strict';
import test from 'node:test';

import { createEmptySlot } from './sessionSlot';

// Chat state syncs the token counter with `if (slot.tokenUsage !== undefined)`.
// Providers whose history endpoint reports no usage (Claude) deliver the budget
// over the websocket instead. A `null` default makes that guard always pass, so
// the first history refresh after a turn resets a correct counter to 0.
test('a fresh slot reports no token usage until the server sends some', () => {
  const slot = createEmptySlot();

  assert.equal(slot.tokenUsage, undefined);
});
