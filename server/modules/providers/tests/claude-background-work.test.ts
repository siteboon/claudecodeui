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
  // The session's own turn issued the call, so the task is its own work.
  tracker.apply('s1', {
    type: 'assistant',
    parent_tool_use_id: null,
    message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_t1', name: 'Workflow', input: {} }] },
  });
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

test('a task started for a call the session itself made is its own; one from inside an agent is nested', () => {
  // Verified on a real run: a workflow agent that backgrounds `sleep 60` puts
  // a `task_started` on the parent's stream, with a tool_use_id from the
  // agent's transcript. The parent transcript has no card for it, and the
  // pill would otherwise read "3 tasks" for one workflow.
  const tracker = createBackgroundWorkTracker();
  tracker.apply('s1', {
    type: 'assistant',
    parent_tool_use_id: null,
    message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_t1', name: 'Workflow', input: {} }] },
  });
  tracker.apply('s1', started('t1', { task_type: 'local_workflow', workflow_name: 'spec' }));
  tracker.apply('s1', started('t2', { task_type: 'local_bash', description: 'Sleep for 60 seconds' }));

  const [entry] = tracker.list();
  assert.deepEqual(entry.tasks.map((task) => [task.taskId, task.nested ?? false]), [['t1', false], ['t2', true]]);
  assert.equal(tracker.has('s1', 't2'), true, 'a nested task can still be stopped');

  // The set of own calls dies with the session, like the tasks.
  tracker.clear('s1');
  tracker.apply('s1', started('t1', { task_type: 'local_workflow' }));
  assert.equal(tracker.list()[0].tasks[0].nested, true);
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

// Once a task settles, the CLI still hands its result to the model, and a new
// turn started before it has replaces the process mid-relay and forks the
// transcript. Only the process going away (`clear`) ends that: the relay can be
// a turn of its own after the next `result`.
const text = (value: string) => ({ type: 'assistant', message: { content: [{ type: 'text', text: value }] } });
const result = { type: 'result', subtype: 'success' };
const init = { type: 'system', subtype: 'init' };
const call = (taskId: string, name = 'Bash') => ({
  type: 'assistant',
  parent_tool_use_id: null,
  message: { role: 'assistant', content: [{ type: 'tool_use', id: `toolu_${taskId}`, name, input: {} }] },
});
const answer = (taskId: string, content: string) => ({
  type: 'user',
  parent_tool_use_id: null,
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `toolu_${taskId}`, content }] },
});
// A backgrounded call as the stream carries it: the call, its task, and the
// tool result that returns at once with the task id.
const launch = (tracker: ReturnType<typeof createBackgroundWorkTracker>, session: string, taskId: string) => {
  tracker.apply(session, call(taskId));
  tracker.apply(session, started(taskId, { task_type: 'local_bash' }));
  tracker.apply(session, answer(taskId, `Command running in background with ID: ${taskId}`));
};

test('once a task reports in, the session is reporting until its process is gone', () => {
  const tracker = createBackgroundWorkTracker();
  launch(tracker, 's1', 't1');
  launch(tracker, 's1', 't2');
  tracker.apply('s1', notified('t1', 'completed'));
  assert.equal(tracker.hasOutstanding('s1'), true, 'the other task is still running');
  assert.equal(tracker.isReporting('s1'), true, 't1 is being relayed meanwhile');

  tracker.apply('s1', notified('t2', 'completed'));
  assert.equal(tracker.hasOutstanding('s1'), false);
  assert.deepEqual(tracker.list(), []);
  assert.equal(tracker.isReporting('s1'), true);

  tracker.apply('s1', text('The job finished.'));
  tracker.apply('s1', result);
  assert.equal(tracker.isReporting('s1'), true, 'a result does not end it');
  tracker.clear('s1');
  assert.equal(tracker.isReporting('s1'), false);
});

test('a task that settles during a model call is still reporting after that turn\'s result', () => {
  // Measured with claude 2.1.280: the notification is not folded into the call
  // in flight; the CLI pushes a separate relay turn after the turn's result.
  const tracker = createBackgroundWorkTracker();
  launch(tracker, 's1', 't1');
  tracker.apply('s1', notified('t1', 'completed'));
  tracker.apply('s1', text('A ended its turn'));
  tracker.apply('s1', result);
  assert.equal(tracker.isReporting('s1'), true, 'the relay turn has not even started');

  tracker.apply('s1', init);
  tracker.apply('s1', text('RELAYED t1'));
  tracker.apply('s1', result);
  assert.equal(tracker.isReporting('s1'), true, 'still up until the process exits');
  tracker.clear('s1');
  assert.equal(tracker.isReporting('s1'), false);
});

test('a task that settles during another task\'s relay keeps the session reporting through both relays', () => {
  const tracker = createBackgroundWorkTracker();
  launch(tracker, 's1', 't1');
  launch(tracker, 's1', 't2');
  tracker.apply('s1', result);
  tracker.apply('s1', notified('t1', 'completed'));
  tracker.apply('s1', init);
  tracker.apply('s1', notified('t2', 'completed'));
  assert.equal(tracker.isReporting('s1'), true);

  // The first relay ends; the CLI pushes the second one after its result.
  tracker.apply('s1', text('RELAYED t1'));
  tracker.apply('s1', result);
  assert.equal(tracker.isReporting('s1'), true);
  tracker.apply('s1', init);
  tracker.apply('s1', text('RELAYED t2'));
  tracker.apply('s1', result);
  assert.equal(tracker.isReporting('s1'), true);
  tracker.clear('s1');
  assert.equal(tracker.isReporting('s1'), false);
});

// The last task is stopped (from the pill, or by the model calling TaskStop in
// the relay) while an earlier task's result is still being relayed: the task
// list empties, but the process is still writing that relay.
test('a task stopped during another task\'s relay does not end that relay', () => {
  const tracker = createBackgroundWorkTracker();
  launch(tracker, 's1', 't1');
  launch(tracker, 's1', 't2');
  tracker.apply('s1', result);
  tracker.apply('s1', notified('t1', 'completed'));
  tracker.apply('s1', init);
  tracker.apply('s1', notified('t2', 'stopped'));
  assert.equal(tracker.hasOutstanding('s1'), false);
  assert.equal(tracker.isReporting('s1'), true, 't1 is still being relayed');

  const other = createBackgroundWorkTracker();
  launch(other, 's1', 't1');
  launch(other, 's1', 't2');
  other.apply('s1', notified('t1', 'completed'));
  other.apply('s1', updated('t2', { status: 'killed', end_time: 1 }));
  other.apply('s1', notified('t2', 'stopped'));
  assert.equal(other.hasOutstanding('s1'), false);
  assert.equal(other.isReporting('s1'), true);
  other.clear('s1');
  assert.equal(other.isReporting('s1'), false);
});

// Measured with claude 2.1.280: the task of a foreground agent, or of a
// foreground command that runs for more than about 3 s, settles before its
// tool result, which carries its outcome, and no relay turn follows.
test('a task that settles before its own call returns leaves nothing to relay', () => {
  const tracker = createBackgroundWorkTracker();
  tracker.apply('s1', call('a1', 'Agent'));
  tracker.apply('s1', started('a1'));
  tracker.apply('s1', notified('a1', 'completed'));
  tracker.apply('s1', answer('a1', 'FOUR'));
  tracker.apply('s1', call('f1'));
  tracker.apply('s1', started('f1', { task_type: 'local_bash' }));
  tracker.apply('s1', updated('f1', { status: 'completed', end_time: 1 }));
  tracker.apply('s1', answer('f1', '(Bash completed with no output)'));
  tracker.apply('s1', text('A ended its turn'));
  tracker.apply('s1', result);
  assert.equal(tracker.hasOutstanding('s1'), false);
  assert.equal(tracker.isReporting('s1'), false);

  // A backgrounded call answered before its task settles is still relayed.
  launch(tracker, 's1', 't1');
  tracker.apply('s1', notified('t1', 'completed'));
  assert.equal(tracker.isReporting('s1'), true);

  // A nested task's call is answered inside its agent, out of this stream's
  // sight, so it counts as relayed.
  const nested = createBackgroundWorkTracker();
  nested.apply('s1', started('n1', { task_type: 'local_bash' }));
  nested.apply('s1', notified('n1', 'completed'));
  assert.equal(nested.isReporting('s1'), true);
});

test('a failed task is reported like a completed one', () => {
  const tracker = createBackgroundWorkTracker();
  launch(tracker, 's1', 't1');
  tracker.apply('s1', updated('t1', { status: 'failed', end_time: 1 }));
  assert.equal(tracker.isReporting('s1'), true);
  // Its notification arriving afterwards changes nothing.
  tracker.apply('s1', notified('t1', 'failed'));
  assert.equal(tracker.isReporting('s1'), true);
});

test('a stopped task leaves no report behind', () => {
  // The CLI pushes no turn for it; the run loop releases the process on the
  // notification instead.
  const tracker = createBackgroundWorkTracker();
  tracker.apply('s1', started('t1'));
  tracker.apply('s1', notified('t1', 'stopped'));
  assert.equal(tracker.isReporting('s1'), false);

  tracker.apply('s1', started('t2'));
  tracker.apply('s1', updated('t2', { status: 'killed', end_time: 1 }));
  tracker.apply('s1', notified('t2', 'stopped'));
  assert.equal(tracker.isReporting('s1'), false);
});

test('a notification for a task that was never tracked is not a report', () => {
  const tracker = createBackgroundWorkTracker();
  tracker.apply('s1', notified('ambient', 'completed'));
  assert.equal(tracker.isReporting('s1'), false);
});

test('clearing a session drops its pending report and leaves the others alone', () => {
  const tracker = createBackgroundWorkTracker();
  for (const session of ['s1', 's2']) {
    launch(tracker, session, `t-${session}`);
    tracker.apply(session, notified(`t-${session}`, 'completed'));
  }
  tracker.clear('s1');

  assert.equal(tracker.isReporting('s1'), false);
  assert.equal(tracker.isReporting('s2'), true);
});
