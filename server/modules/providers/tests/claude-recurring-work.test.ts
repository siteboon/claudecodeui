import assert from 'node:assert/strict';
import test from 'node:test';

import {
  RECURRING_WORK_TOOLS,
  startsRecurringWork,
} from '@/modules/providers/list/claude/claude-runtime.provider.js';

/**
 * Work that repeats has no ending to wait for, so the usual rule — nothing has
 * happened lately, let the process go — is exactly wrong for it. `/loop 10m`
 * died that way: one tick, then the process was released and the in-process
 * cron went with it.
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

test('a recurring cron marks the conversation as repeating', () => {
  const message = assistantWith(toolUse('CronCreate', { cron: '*/10 * * * *', recurring: true }));
  assert.equal(startsRecurringWork(message), true);
});

test('a one-shot schedule is ordinary background work, not repeating', () => {
  assert.equal(startsRecurringWork(assistantWith(toolUse('CronCreate', { cron: '0 9 * * *' }))), false);
  assert.equal(
    startsRecurringWork(assistantWith(toolUse('CronCreate', { recurring: false }))),
    false,
    'an explicit one-shot must not pin the process',
  );
});

test('an armed Monitor repeats by nature', () => {
  for (const name of RECURRING_WORK_TOOLS) {
    assert.equal(startsRecurringWork(assistantWith(toolUse(name))), true, `${name} should repeat`);
  }
});

test('ordinary background work is not treated as repeating', () => {
  // These finish and report back; the difference matters because repeating
  // work suspends the idle countdown outright.
  for (const name of ['Agent', 'Workflow', 'TaskCreate', 'ScheduleWakeup']) {
    assert.equal(startsRecurringWork(assistantWith(toolUse(name))), false, `${name} has an ending`);
  }
  assert.equal(startsRecurringWork(assistantWith(toolUse('Bash', { run_in_background: true }))), false);
});

test('messages with no tool call never mark a conversation as repeating', () => {
  assert.equal(startsRecurringWork(assistantWith({ type: 'text', text: 'hi' })), false);
  assert.equal(startsRecurringWork(undefined as unknown as object), false);
  assert.equal(startsRecurringWork(null as unknown as object), false);
});
