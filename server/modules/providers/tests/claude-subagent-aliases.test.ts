import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SUBAGENT_TOOL_NAMES,
  startsBackgroundWork,
} from '@/modules/providers/list/claude/claude-runtime.provider.js';

/**
 * The server keeps its own copy of the alias list because the two build roots
 * cannot share a module. This pins the copies together: if one drifts, the
 * lifecycle rules stop applying to whichever name was dropped, silently.
 */

test('the server knows both names the subagent tool has had', () => {
  assert.deepEqual([...SUBAGENT_TOOL_NAMES].sort(), ['Agent', 'Task']);
});

test('a turn is held for a subagent under either name', () => {
  for (const name of SUBAGENT_TOOL_NAMES) {
    const message = { type: 'assistant', message: { content: [{ type: 'tool_use', name, input: {} }] } };
    assert.equal(startsBackgroundWork(message), true, `${name} should hold the process`);
  }
});

test('the foreground opt-out works under either name', () => {
  for (const name of SUBAGENT_TOOL_NAMES) {
    const message = {
      type: 'assistant',
      message: { content: [{ type: 'tool_use', name, input: { run_in_background: false } }] },
    };
    assert.equal(startsBackgroundWork(message), false, `${name} should release when asked to`);
  }
});
