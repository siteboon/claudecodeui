import assert from 'node:assert/strict';
import test from 'node:test';

import {
  decideHoldAfterResult,
  RECURRING_WORK_TOOLS,
  startsRecurringWork,
  stopsRecurringWork,
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

test('CronDelete stands the repeating job down', () => {
  assert.equal(stopsRecurringWork(assistantWith(toolUse('CronDelete', { jobId: '72500182' }))), true);
});

test('nothing else stands it down', () => {
  // Left sticky on purpose: the mark has to outlive the turn that made it, or
  // the tick an hour later finds a conversation that looks ordinary again.
  for (const name of ['CronCreate', 'CronList', 'Monitor', 'Bash', 'TaskUpdate']) {
    assert.equal(stopsRecurringWork(assistantWith(toolUse(name))), false, `${name} must not clear it`);
  }
  assert.equal(stopsRecurringWork(assistantWith({ type: 'text', text: 'stop the loop' })), false);
  assert.equal(stopsRecurringWork(undefined as unknown as object), false);
});

/**
 * The decision T8 turns on. `/loop 10m` fired once and went quiet: the tick's
 * `result` was read as the background work reporting in, the process was let
 * go, and the in-process cron went with it. One automatic tick out of roughly
 * six hundred expected.
 */

test('a turn that started background work arms the hold', () => {
  assert.equal(decideHoldAfterResult({ backgroundWorkPending: true, recurring: false }), 'arm');
});

test('an ordinary turn with nothing outstanding releases the process', () => {
  assert.equal(decideHoldAfterResult({ backgroundWorkPending: false, recurring: false }), 'release');
});

test('a tick of a recurring job re-arms instead of releasing', () => {
  // The tick itself calls no background tool, so `backgroundWorkPending` is
  // false — which is exactly why the old code let the process go here.
  assert.equal(decideHoldAfterResult({ backgroundWorkPending: false, recurring: true }), 'rearm');
});

test('arming wins when a turn both ticks and starts new work', () => {
  // Re-arming would restart the countdown; arming records the new work as
  // outstanding, which is the stronger claim of the two.
  assert.equal(decideHoldAfterResult({ backgroundWorkPending: true, recurring: true }), 'arm');
});

test('the decision never releases while anything is still going', () => {
  for (const backgroundWorkPending of [true, false]) {
    for (const recurring of [true, false]) {
      const decision = decideHoldAfterResult({ backgroundWorkPending, recurring });
      if (backgroundWorkPending || recurring) {
        assert.notEqual(decision, 'release', `${backgroundWorkPending}/${recurring} must not release`);
      }
    }
  }
});
