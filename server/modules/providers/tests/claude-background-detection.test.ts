import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFERRED_WORK_TOOLS,
  startsBackgroundWork,
} from '@/modules/providers/list/claude/claude-runtime.provider.js';

/**
 * `startsBackgroundWork` decides whether a turn's CLI process is held open past
 * its `result`. Get it wrong in one direction and background work is cut off
 * with nowhere to report back; wrong in the other and an abandoned session
 * leaks a CLI process. It had no coverage before this file.
 */

const assistantWith = (...blocks: unknown[]) => ({
  type: 'assistant',
  message: { content: blocks },
});

const toolUse = (name: string, input?: Record<string, unknown>) => ({
  type: 'tool_use',
  name,
  ...(input ? { input } : {}),
});

test('every deferred-work tool holds the process open', () => {
  for (const name of DEFERRED_WORK_TOOLS) {
    assert.equal(
      startsBackgroundWork(assistantWith(toolUse(name))),
      true,
      `${name} should be treated as background work`,
    );
  }
});

test('Bash is decided by its input, not by its name', () => {
  assert.equal(startsBackgroundWork(assistantWith(toolUse('Bash', { run_in_background: true }))), true);
  assert.equal(startsBackgroundWork(assistantWith(toolUse('Bash', { run_in_background: false }))), false);
  assert.equal(startsBackgroundWork(assistantWith(toolUse('Bash', { command: 'ls' }))), false);
  // A truthy-but-not-true value must not count: the CLI only backgrounds on `true`.
  assert.equal(startsBackgroundWork(assistantWith(toolUse('Bash', { run_in_background: 'yes' }))), false);
});

test('an ordinary tool turn releases the process, as it always has', () => {
  assert.equal(startsBackgroundWork(assistantWith(toolUse('Read', { file_path: '/tmp/x' }))), false);
  assert.equal(startsBackgroundWork(assistantWith(toolUse('Edit'), toolUse('Write'))), false);
});

test('one background tool among several still holds the turn', () => {
  const message = assistantWith(toolUse('Read'), toolUse('Monitor'), toolUse('Edit'));
  assert.equal(startsBackgroundWork(message), true);
});

test('messages without a tool_use block never hold', () => {
  assert.equal(startsBackgroundWork(assistantWith({ type: 'text', text: 'done' })), false);
  assert.equal(startsBackgroundWork(assistantWith()), false);
  assert.equal(startsBackgroundWork({ type: 'assistant', message: { content: 'plain string' } }), false);
  assert.equal(startsBackgroundWork({ type: 'result' }), false);
  // The guard exists precisely for these, so the test has to get past the
  // parameter type to reach it.
  assert.equal(startsBackgroundWork(undefined as unknown as object), false);
  assert.equal(startsBackgroundWork(null as unknown as object), false);
});

/**
 * T3: `Agent` and `Workflow` both outlive the turn that starts them, and
 * neither is detected today. These assertions record the defect rather than
 * the intent — the fix flips them to `true`, and this test is how that fix is
 * shown to work.
 */
test('DEFECT (T3): Agent and Workflow are not recognised as background work', () => {
  assert.equal(startsBackgroundWork(assistantWith(toolUse('Agent', { prompt: 'go' }))), false);
  assert.equal(startsBackgroundWork(assistantWith(toolUse('Workflow', { script: '...' }))), false);
});
