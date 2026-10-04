import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CLI_BG_HARD_CEILING_MS,
  shouldReleaseOnSilence,
} from '@/modules/providers/list/claude/claude-runtime.provider.js';

// The CLI counts its ceiling from the end of the turn and applies it once stdin
// closes; a 30 minute value there killed every background Workflow that ran longer.
test('claude runtime: the CLI wait ceiling is far longer than the 30 minute silence hold', () => {
  assert.ok(CLI_BG_HARD_CEILING_MS === 0 || CLI_BG_HARD_CEILING_MS >= 4 * 60 * 60 * 1000);
});

test('claude runtime: silence alone does not release a hold whose tasks are still outstanding', () => {
  const hour = 60 * 60 * 1000;
  const held = { heldSinceMs: 0, hardCeilingMs: 6 * hour };
  assert.equal(shouldReleaseOnSilence({ ...held, outstanding: false, nowMs: hour / 2 }), true);
  assert.equal(shouldReleaseOnSilence({ ...held, outstanding: true, nowMs: hour / 2 }), false);
  assert.equal(shouldReleaseOnSilence({ ...held, outstanding: true, nowMs: 6 * hour }), true);
  assert.equal(shouldReleaseOnSilence({ ...held, hardCeilingMs: 0, outstanding: true, nowMs: 48 * hour }), false);
});
