import assert from 'node:assert/strict';
import test from 'node:test';

import { startsBackgroundWork } from '@/modules/providers/list/claude/claude-runtime.provider.js';

// Only turns that start work outliving the turn hold their CLI process open. A
// turn scored `false` here has its stdin released the moment `result` arrives,
// and the CLI reads that EOF as print wind-down — so anything still running dies.
const turn = (...blocks: Array<{ name: string; input?: Record<string, unknown> }>) => ({
  type: 'assistant',
  message: { content: blocks.map((block) => ({ type: 'tool_use', input: {}, ...block })) },
});

test('a backgrounded Bash holds the process open', () => {
  assert.equal(startsBackgroundWork(turn({ name: 'Bash', input: { run_in_background: true } })), true);
});

test('a foreground Bash does not', () => {
  assert.equal(startsBackgroundWork(turn({ name: 'Bash', input: { run_in_background: false } })), false);
});

test('a backgrounded Agent holds the process open', () => {
  // The gap this suite exists for: a background agent used to be scored as
  // nothing outstanding, so the CLI wound down and killed it mid-run.
  assert.equal(startsBackgroundWork(turn({ name: 'Agent', input: { run_in_background: true } })), true);
});

test('an Agent with no run_in_background holds the process open', () => {
  // `run_in_background` is optional on AgentInput and agents background by
  // default, so an omitted field means background, not foreground.
  assert.equal(startsBackgroundWork(turn({ name: 'Agent', input: { prompt: 'Investigate' } })), true);
});

test('a foreground Agent does not', () => {
  // It never pushes a follow-up turn, so holding for it would pin the process
  // for the full BG_WAIT_CEILING_MS.
  assert.equal(startsBackgroundWork(turn({ name: 'Agent', input: { run_in_background: false } })), false);
});

test('a Workflow holds the process open', () => {
  // WorkflowInput has no foreground option: every call returns a task id
  // immediately and reports back in a later turn.
  assert.equal(startsBackgroundWork(turn({ name: 'Workflow', input: { script: 'export const meta = {}' } })), true);
});

test('a deferred-work tool holds the process open', () => {
  assert.equal(startsBackgroundWork(turn({ name: 'Monitor' })), true);
});

test('a turn that starts nothing lasting does not', () => {
  assert.equal(startsBackgroundWork(turn({ name: 'Read' })), false);
});

test('one backgrounded agent among foreground calls is enough', () => {
  assert.equal(
    startsBackgroundWork(
      turn(
        { name: 'Read' },
        { name: 'Agent', input: { run_in_background: false } },
        { name: 'Agent', input: { run_in_background: true } },
      ),
    ),
    true,
  );
});

test('a message carrying no tool calls does not', () => {
  assert.equal(startsBackgroundWork({ type: 'result', message: { content: 'done' } }), false);
  assert.equal(startsBackgroundWork({ type: 'assistant', message: { content: [] } }), false);
  assert.equal(startsBackgroundWork({}), false);
});
