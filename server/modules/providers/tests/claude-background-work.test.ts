import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createBackgroundWorkTracker,
  startsBackgroundWork,
} from '@/modules/providers/list/claude/claude-runtime.provider.js';

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

// Once the turn's `result` is out, the tracker below is the only record of
// what the held process is still running: the running-sessions list reads it
// and a stop request is refused unless it names one of its tasks. The event
// shapes are the SDK's own, as a real query emits them.
const started = (taskId: string, extra: Record<string, unknown> = {}) => ({
  type: 'system',
  subtype: 'task_started',
  task_id: taskId,
  tool_use_id: `toolu_${taskId}`,
  description: `Task ${taskId}`,
  task_type: 'local_agent',
  ...extra,
});
const notified = (taskId: string, status: string) => ({
  type: 'system', subtype: 'task_notification', task_id: taskId, tool_use_id: `toolu_${taskId}`, status, summary: '', output_file: '',
});
const updated = (taskId: string, patch: Record<string, unknown>) => ({
  type: 'system', subtype: 'task_updated', task_id: taskId, patch,
});

test('a task_started with a tool_use_id adds the task under its session', () => {
  const tracker = createBackgroundWorkTracker();
  const before = Date.now();
  tracker.apply('s1', started('t1', { task_type: 'local_workflow', workflow_name: 'spec' }));

  const [entry] = tracker.list();
  assert.equal(tracker.list().length, 1);
  assert.equal(entry.sessionId, 's1');
  assert.equal(entry.tasks.length, 1);
  const { startedAt, ...task } = entry.tasks[0];
  assert.deepEqual(task, {
    taskId: 't1',
    toolUseId: 'toolu_t1',
    taskType: 'local_workflow',
    description: 'Task t1',
    workflowName: 'spec',
  });
  assert.ok(startedAt >= before && startedAt <= Date.now());
  assert.equal(tracker.hasOutstanding('s1'), true);
  assert.equal(tracker.has('s1', 't1'), true);
});

test('a task_started without a tool_use_id is not tracked', () => {
  // Housekeeping tasks the CLI starts on its own have no launching call and
  // nothing in the transcript to show them under.
  const tracker = createBackgroundWorkTracker();
  tracker.apply('s1', { type: 'system', subtype: 'task_started', task_id: 'ambient', description: 'x' });

  assert.deepEqual(tracker.list(), []);
  assert.equal(tracker.hasOutstanding('s1'), false);
});

test('a task_notification removes the task whatever its status', () => {
  const tracker = createBackgroundWorkTracker();
  tracker.apply('s1', started('t1'));
  tracker.apply('s1', started('t2'));
  tracker.apply('s1', notified('t1', 'completed'));

  assert.equal(tracker.has('s1', 't1'), false);
  assert.equal(tracker.has('s1', 't2'), true);
  assert.equal(tracker.hasOutstanding('s1'), true);

  tracker.apply('s1', notified('t2', 'stopped'));
  assert.equal(tracker.hasOutstanding('s1'), false);
  assert.deepEqual(tracker.list(), []);
});

test('a terminal task_updated removes the task', () => {
  const tracker = createBackgroundWorkTracker();
  for (const [taskId, status] of [['a', 'completed'], ['b', 'failed'], ['c', 'killed']]) {
    tracker.apply('s1', started(taskId));
    tracker.apply('s1', updated(taskId, { status, end_time: 1 }));
    assert.equal(tracker.has('s1', taskId), false, `${status} settles the task`);
  }
  assert.equal(tracker.hasOutstanding('s1'), false);
});

test('a non-terminal task_updated keeps the task', () => {
  const tracker = createBackgroundWorkTracker();
  tracker.apply('s1', started('t1'));
  tracker.apply('s1', updated('t1', { status: 'running' }));
  tracker.apply('s1', updated('t1', { is_backgrounded: true }));
  tracker.apply('s1', updated('t1', { status: 'paused' }));

  assert.equal(tracker.has('s1', 't1'), true);
  assert.equal(tracker.hasOutstanding('s1'), true);
});

test('clearing a session empties it and leaves the others alone', () => {
  const tracker = createBackgroundWorkTracker();
  tracker.apply('s1', started('t1'));
  tracker.apply('s2', started('t2'));
  tracker.clear('s1');

  assert.equal(tracker.hasOutstanding('s1'), false);
  assert.equal(tracker.has('s1', 't1'), false);
  assert.deepEqual(tracker.list().map((entry) => entry.sessionId), ['s2']);
});

test('messages that are not task events leave the set untouched', () => {
  const tracker = createBackgroundWorkTracker();
  tracker.apply('s1', started('t1'));
  tracker.apply('s1', { type: 'assistant', message: { content: [] } });
  tracker.apply('s1', { type: 'system', subtype: 'task_progress', task_id: 't1', description: 'x', usage: {} });
  tracker.apply('s1', { type: 'result', task_id: 't1' });

  assert.equal(tracker.has('s1', 't1'), true);
});
