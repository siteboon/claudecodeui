import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ClaudeSessionsProvider } from '@/modules/providers/list/claude/claude-sessions.provider.js';
import { CLAUDE_PREDEFINED_MODELS } from '@/modules/providers/list/claude/claude-models.provider.js';
import {
  hasActiveHeldTurn,
  listClaudeSDKBackgroundWork,
  queryClaudeSDK,
  readHeldTurnWaitMs,
  stopClaudeSDKTask,
} from '@/modules/providers/list/claude/claude-runtime.provider.js';
import type { NormalizedMessage, ProviderRuntimeContext } from '@/shared/types.js';

/**
 * The runtime keeps the CLI's stdin open after a turn's `result` while the
 * turn's background work is outstanding, and lets go when that work has
 * reported. These drive `queryClaudeSDK` with a scripted SDK stream — the
 * seam is `context.createQuery` — and watch the held prompt stream: the CLI
 * exits when it ends, so "released" is the whole outcome.
 */

const SESSION_ID = 'app-hold-session';
const NATIVE_ID = 'native-hold-session';

type Scripted = {
  emit: (message: Record<string, unknown>) => void;
  end: () => void;
  released: () => boolean;
  stopped: string[];
  /** What the run asked of the process, in order: `interrupt`, `release`, `close`. */
  calls: string[];
  /** Runs when the process is interrupted; a real CLI answers with the turn's `result`. */
  onInterrupt: (() => void) | null;
  /** Runs when the process is closed, in place of ending the stream at once. */
  onClose: (() => void) | null;
};

/** A stand-in for the SDK query: yields what the test emits, and reads the held prompt to notice its release. */
function createScriptedQuery(): { createQuery: NonNullable<ProviderRuntimeContext['createQuery']>; script: Scripted } {
  const queue: Array<Record<string, unknown> | null> = [];
  let wake: (() => void) | null = null;
  let released = false;
  const stopped: string[] = [];

  const script: Scripted = {
    emit: (message) => { queue.push(message); wake?.(); },
    end: () => { queue.push(null); wake?.(); },
    released: () => released,
    stopped,
    calls: [],
    onInterrupt: null,
    onClose: null,
  };

  const createQuery: NonNullable<ProviderRuntimeContext['createQuery']> = ({ prompt }) => {
    void (async () => {
      for await (const _message of prompt) { /* the CLI reads its stdin */ }
      released = true;
      script.calls.push('release');
    })();

    const iterator = (async function* () {
      for (;;) {
        if (queue.length === 0) {
          await new Promise<void>((resolve) => { wake = resolve; });
          wake = null;
          continue;
        }
        const next = queue.shift();
        if (next === null || next === undefined) {
          return;
        }
        yield next;
      }
    })();

    return Object.assign(iterator, {
      interrupt: async () => { script.calls.push('interrupt'); script.onInterrupt?.(); },
      close: () => { script.calls.push('close'); (script.onClose ?? script.end)(); },
      stopTask: async (taskId: string) => { stopped.push(taskId); },
    });
  };

  return { createQuery, script };
}

async function withRun(
  runTest: (context: { script: Scripted; sent: NormalizedMessage[]; done: Promise<unknown> }) => Promise<void>,
): Promise<void> {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'claude-runtime-hold-'));
  const { createQuery, script } = createScriptedQuery();
  const sent: NormalizedMessage[] = [];
  const writer = { send: (message: NormalizedMessage) => { sent.push(message); }, userId: null };
  const sessions = new ClaudeSessionsProvider({ getLiveRunStartTime: () => null });
  const context: ProviderRuntimeContext = {
    resolveProviderSessionId: () => null,
    resolveResumeModel: async () => undefined,
    getProviderModels: async () => CLAUDE_PREDEFINED_MODELS as never,
    normalizeMessage: (raw, sessionId) => sessions.normalizeMessage(raw, sessionId),
    isProviderInstalled: async () => true,
    createQuery,
  };

  try {
    const done = queryClaudeSDK('hello', { sessionId: SESSION_ID, cwd }, writer as never, context);
    await runTest({ script, sent, done });
    script.end();
    await done;
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

const settle = () => new Promise((resolve) => { setTimeout(resolve, 25); });

// A fixed settle can be too short on a loaded machine; the supersede tests
// wait for the run to have actually processed its turn instead.
async function waitFor(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200 && !condition(); attempt += 1) {
    await settle();
  }
  assert.ok(condition(), 'condition never became true');
}

const init = () => ({ type: 'system', subtype: 'init', session_id: NATIVE_ID });
const toolUse = (id: string, name: string, input: Record<string, unknown>) => ({
  type: 'assistant', session_id: NATIVE_ID, parent_tool_use_id: null,
  message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] },
});
const ack = (id: string, text: string, toolUseResult: Record<string, unknown>) => ({
  type: 'user', session_id: NATIVE_ID, parent_tool_use_id: null,
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text }] },
  tool_use_result: toolUseResult,
});
const taskStarted = (taskId: string, toolUseId: string, taskType: string) => ({
  type: 'system', subtype: 'task_started', session_id: NATIVE_ID, task_id: taskId, tool_use_id: toolUseId, description: `Task ${taskId}`, task_type: taskType,
});
const taskNotification = (taskId: string, toolUseId: string, status: string) => ({
  type: 'system', subtype: 'task_notification', session_id: NATIVE_ID, task_id: taskId, tool_use_id: toolUseId, status, summary: `Task ${taskId} ${status}`, output_file: '',
});
const result = () => ({ type: 'result', subtype: 'success', session_id: NATIVE_ID, result: 'launched', duration_ms: 1, num_turns: 1 });

test('stopping the last outstanding task releases the held process', async () => {
  await withRun(async ({ script, sent, done }) => {
    script.emit(init());
    script.emit(toolUse('toolu_wf', 'Workflow', { script: 'export const meta = {}' }));
    script.emit(taskStarted('wf1', 'toolu_wf', 'local_workflow'));
    script.emit(ack('toolu_wf', 'Workflow launched in background. Task ID: wf1', { status: 'async_launched', taskId: 'wf1', taskType: 'local_workflow' }));
    script.emit(result());
    await settle();

    // The turn is over for the client, the process is held for the workflow.
    assert.ok(sent.some((message) => message.kind === 'complete'));
    assert.deepEqual(listClaudeSDKBackgroundWork().map((entry) => [entry.sessionId, entry.tasks.map((task) => task.taskId)]), [[SESSION_ID, ['wf1']]]);
    assert.equal(script.released(), false, 'stdin stays open while the workflow runs');

    // The user stops it. The CLI answers with a `stopped` notification and
    // pushes no follow-up turn, so nothing else would ever end the hold.
    assert.equal(await stopClaudeSDKTask(SESSION_ID, 'wf1'), true);
    assert.deepEqual(script.stopped, ['wf1']);
    script.emit(taskNotification('wf1', 'toolu_wf', 'stopped'));
    await settle();

    assert.deepEqual(listClaudeSDKBackgroundWork(), []);
    assert.equal(script.released(), true, 'the process is let go once nothing is outstanding');
    void done;
  });
});

test('a task that reported completed keeps the hold for the turn that relays its result', async () => {
  await withRun(async ({ script }) => {
    script.emit(init());
    script.emit(toolUse('toolu_wf', 'Workflow', { script: 'export const meta = {}' }));
    script.emit(taskStarted('wf1', 'toolu_wf', 'local_workflow'));
    script.emit(ack('toolu_wf', 'Workflow launched in background. Task ID: wf1', { status: 'async_launched', taskId: 'wf1', taskType: 'local_workflow' }));
    script.emit(result());
    await settle();

    // Completed, unlike stopped, is followed by a turn the CLI pushes to relay
    // the result; closing stdin at the notification would cut it short.
    script.emit(taskNotification('wf1', 'toolu_wf', 'completed'));
    await settle();
    assert.equal(script.released(), false);

    script.emit(result());
    await settle();
    assert.equal(script.released(), true, 'the follow-up turn\'s result ends the hold');
  });
});

test('an agent that ran in the foreground and settled before the result does not hold the process', async () => {
  await withRun(async ({ script }) => {
    // An Agent call without `run_in_background` is scored as background by
    // the static rule, but the CLI ran it in the foreground: its task started
    // and settled before the turn ended. The task events know that.
    script.emit(init());
    script.emit(toolUse('toolu_agent', 'Agent', { prompt: 'Return the word FOUR', subagent_type: 'general-purpose' }));
    script.emit(taskStarted('a1', 'toolu_agent', 'local_agent'));
    script.emit(taskNotification('a1', 'toolu_agent', 'completed'));
    script.emit(ack('toolu_agent', 'FOUR', { status: 'completed', agentId: 'a1' }));
    script.emit(result());
    await settle();

    assert.deepEqual(listClaudeSDKBackgroundWork(), []);
    assert.equal(script.released(), true, 'nothing is outstanding, so nothing to hold for');
  });
});

test('a new turn stops the tasks the held process still has going before letting it go', async () => {
  // Two runs on one session, each with its own scripted CLI: the first is
  // held for a background agent, the second is the user's next message.
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'claude-runtime-hold-'));
  const first = createScriptedQuery();
  const second = createScriptedQuery();
  const sent: NormalizedMessage[] = [];
  const writer = { send: (message: NormalizedMessage) => { sent.push(message); }, userId: null };
  const sessions = new ClaudeSessionsProvider({ getLiveRunStartTime: () => null });
  const context: Omit<ProviderRuntimeContext, 'createQuery'> = {
    resolveProviderSessionId: () => null,
    resolveResumeModel: async () => undefined,
    getProviderModels: async () => CLAUDE_PREDEFINED_MODELS as never,
    normalizeMessage: (raw, sessionId) => sessions.normalizeMessage(raw, sessionId),
    isProviderInstalled: async () => true,
  };

  try {
    const firstRun = queryClaudeSDK('start an agent', { sessionId: SESSION_ID, cwd }, writer as never, { ...context, createQuery: first.createQuery });
    await settle();
    first.script.emit(init());
    first.script.emit(toolUse('toolu_agent', 'Agent', { prompt: 'sleep 90', subagent_type: 'general-purpose', run_in_background: true }));
    first.script.emit(taskStarted('a1', 'toolu_agent', 'local_agent'));
    first.script.emit(ack('toolu_agent', 'Async agent launched successfully.', { status: 'async_launched', agentId: 'a1' }));
    first.script.emit(result());
    await waitFor(() => sent.some((message) => message.kind === 'complete'));
    assert.equal(first.script.released(), false, 'the first process is held for its agent');

    // Closing stdin alone would leave the CLI waiting for the agent, so the
    // superseded process would live on next to the new one for as long as
    // the agent runs. The stop has to reach it before stdin ends, because the
    // SDK drops control requests written to an ended stdin.
    const secondRun = queryClaudeSDK('Continue', { sessionId: SESSION_ID, cwd }, writer as never, { ...context, createQuery: second.createQuery });
    await settle();
    assert.deepEqual(first.script.stopped, ['a1'], 'the held process is told to stop its agent');
    assert.equal(first.script.released(), true, 'and is then let go');
    assert.deepEqual(second.script.stopped, [], 'the new process is untouched');

    first.script.emit(taskNotification('a1', 'toolu_agent', 'stopped'));
    first.script.end();
    await firstRun;
    second.script.emit(init());
    second.script.emit(result());
    second.script.end();
    await secondRun;
    assert.deepEqual(listClaudeSDKBackgroundWork(), []);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('a held process is still let go when stopping its tasks throws', async () => {
  // Stopping is best effort; a stop that throws on the spot must not keep the
  // held process alive or take the new turn down with it.
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'claude-runtime-hold-'));
  const first = createScriptedQuery();
  const second = createScriptedQuery();
  const sent: NormalizedMessage[] = [];
  const writer = { send: (message: NormalizedMessage) => { sent.push(message); }, userId: null };
  const sessions = new ClaudeSessionsProvider({ getLiveRunStartTime: () => null });
  const context: Omit<ProviderRuntimeContext, 'createQuery'> = {
    resolveProviderSessionId: () => null,
    resolveResumeModel: async () => undefined,
    getProviderModels: async () => CLAUDE_PREDEFINED_MODELS as never,
    normalizeMessage: (raw, sessionId) => sessions.normalizeMessage(raw, sessionId),
    isProviderInstalled: async () => true,
  };
  const throwingStop: NonNullable<ProviderRuntimeContext['createQuery']> = (options) =>
    Object.assign(first.createQuery(options), {
      stopTask: () => { throw new Error('stop failed'); },
    });

  try {
    const firstRun = queryClaudeSDK('start an agent', { sessionId: SESSION_ID, cwd }, writer as never, { ...context, createQuery: throwingStop });
    await settle();
    first.script.emit(init());
    first.script.emit(toolUse('toolu_agent', 'Agent', { prompt: 'sleep 90', subagent_type: 'general-purpose', run_in_background: true }));
    first.script.emit(taskStarted('a1', 'toolu_agent', 'local_agent'));
    first.script.emit(ack('toolu_agent', 'Async agent launched successfully.', { status: 'async_launched', agentId: 'a1' }));
    first.script.emit(result());
    await waitFor(() => sent.some((message) => message.kind === 'complete'));
    assert.equal(first.script.released(), false, 'the first process is held for its agent');

    const secondRun = queryClaudeSDK('Continue', { sessionId: SESSION_ID, cwd }, writer as never, { ...context, createQuery: second.createQuery });
    await settle();
    assert.equal(first.script.released(), true, 'the held process is let go anyway');

    first.script.end();
    await firstRun;
    second.script.emit(init());
    second.script.emit(result());
    second.script.end();
    await secondRun;
    assert.equal(second.script.released(), true, 'the new turn ran to completion');
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('a turn whose tool emits no task events still holds on the static rule', async () => {
  await withRun(async ({ script }) => {
    script.emit(init());
    script.emit(toolUse('toolu_monitor', 'Monitor', { command: 'tail -f x', description: 'watch', timeout_ms: 1000 }));
    script.emit(ack('toolu_monitor', 'Monitor started', {}));
    script.emit(result());
    await settle();

    assert.equal(script.released(), false, 'Monitor reports no task, so the launch rule decides');
  });
});

const assistantText = (text: string) => ({
  type: 'assistant', session_id: NATIVE_ID, parent_tool_use_id: null,
  message: { role: 'assistant', content: [{ type: 'text', text }] },
});

/** Two runs on one session, each with its own scripted CLI, sharing one writer. */
async function withTwoRuns(
  runTest: (context: {
    first: ReturnType<typeof createScriptedQuery>;
    second: ReturnType<typeof createScriptedQuery>;
    sent: NormalizedMessage[];
    startFirst: () => Promise<unknown>;
    startSecond: () => Promise<unknown>;
  }) => Promise<void>,
): Promise<void> {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'claude-runtime-hold-'));
  const first = createScriptedQuery();
  const second = createScriptedQuery();
  const sent: NormalizedMessage[] = [];
  const writer = { send: (message: NormalizedMessage) => { sent.push(message); }, userId: null };
  const sessions = new ClaudeSessionsProvider({ getLiveRunStartTime: () => null });
  const context: Omit<ProviderRuntimeContext, 'createQuery'> = {
    resolveProviderSessionId: () => null,
    resolveResumeModel: async () => undefined,
    getProviderModels: async () => CLAUDE_PREDEFINED_MODELS as never,
    normalizeMessage: (raw, sessionId) => sessions.normalizeMessage(raw, sessionId),
    isProviderInstalled: async () => true,
  };
  try {
    await runTest({
      first,
      second,
      sent,
      startFirst: () => queryClaudeSDK('start a job', { sessionId: SESSION_ID, cwd }, writer as never, { ...context, createQuery: first.createQuery }),
      startSecond: () => queryClaudeSDK('Continue', { sessionId: SESSION_ID, cwd }, writer as never, { ...context, createQuery: second.createQuery }),
    });
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

/** Drives the first run to a held turn end with one backgrounded command outstanding. */
async function holdForBackgroundCommand(script: Scripted, sent: NormalizedMessage[]): Promise<void> {
  script.emit(init());
  script.emit(toolUse('toolu_bg', 'Bash', { command: 'sleep 120', run_in_background: true }));
  script.emit(taskStarted('b1', 'toolu_bg', 'local_bash'));
  script.emit(ack('toolu_bg', 'Command running in background with ID: b1', { backgroundTaskId: 'b1' }));
  script.emit(result());
  await waitFor(() => sent.some((message) => message.kind === 'complete'));
}

test('a held process relaying its last task reads busy from the settle to the relay turn\'s result', async () => {
  await withRun(async ({ script, sent }) => {
    await holdForBackgroundCommand(script, sent);
    assert.equal(hasActiveHeldTurn(SESSION_ID), false, 'between turns the background work alone marks the session');

    // The task settles. The tracker lets go of it at once, but the CLI is
    // about to run a turn to relay it, so the session must not read idle in
    // the gap before that turn's first message arrives.
    script.emit(taskNotification('b1', 'toolu_bg', 'completed'));
    await settle();
    assert.deepEqual(listClaudeSDKBackgroundWork(), []);
    assert.equal(hasActiveHeldTurn(SESSION_ID), true, 'busy from the settle');

    script.emit(assistantText('The job finished.'));
    await settle();
    assert.equal(hasActiveHeldTurn(SESSION_ID), true, 'busy through the relay');

    script.emit(result());
    await settle();
    assert.equal(hasActiveHeldTurn(SESSION_ID), false, 'idle once the relay turn ends');
    assert.equal(script.released(), true);
  });
});

test('a stopped task starts no relay turn, so it does not mark the session busy', async () => {
  await withRun(async ({ script, sent }) => {
    await holdForBackgroundCommand(script, sent);
    script.emit(taskNotification('b1', 'toolu_bg', 'stopped'));
    await settle();
    assert.equal(hasActiveHeldTurn(SESSION_ID), false);
  });
});

test('a follow-up turn no task notification announced also marks the held session busy', async () => {
  await withRun(async ({ script }) => {
    // Monitor reports no task, so the hold rests on the static rule, and the
    // turn it pushes later arrives with no settle in front of it.
    script.emit(init());
    script.emit(toolUse('toolu_monitor', 'Monitor', { command: 'tail -f x', description: 'watch', timeout_ms: 1000 }));
    script.emit(ack('toolu_monitor', 'Monitor started', {}));
    script.emit(result());
    await settle();
    assert.equal(hasActiveHeldTurn(SESSION_ID), false);

    script.emit(assistantText('The log printed an error.'));
    await settle();
    assert.equal(hasActiveHeldTurn(SESSION_ID), true);

    script.emit(result());
    await settle();
    assert.equal(hasActiveHeldTurn(SESSION_ID), false);
  });
});

test('a held process that exits mid-turn no longer marks the session busy', async () => {
  await withRun(async ({ script, sent, done }) => {
    await holdForBackgroundCommand(script, sent);
    script.emit(taskNotification('b1', 'toolu_bg', 'completed'));
    await settle();
    assert.equal(hasActiveHeldTurn(SESSION_ID), true);
    script.end();
    await done;
    assert.equal(hasActiveHeldTurn(SESSION_ID), false);
  });
});

test('a new turn sent while the held process relays waits for that turn to end before taking over', async () => {
  await withTwoRuns(async ({ first, second, sent, startFirst, startSecond }) => {
    const firstRun = startFirst();
    await settle();
    await holdForBackgroundCommand(first.script, sent);
    first.script.emit(taskNotification('b1', 'toolu_bg', 'completed'));
    first.script.emit(assistantText('Relaying the job result.'));
    await settle();

    let secondCreated = false;
    const createSecond = second.createQuery;
    second.createQuery = (options) => { secondCreated = true; return createSecond(options); };
    const secondRun = startSecond();
    await settle();
    await settle();
    assert.equal(first.script.released(), false, 'the relaying process keeps its stdin');
    assert.equal(secondCreated, false, 'the new process is not started mid-turn');
    assert.deepEqual(first.script.calls, [], 'and the relay is not interrupted');

    first.script.emit(result());
    await waitFor(() => secondCreated);
    assert.equal(first.script.released(), true, 'released once its turn is over');

    first.script.end();
    await firstRun;
    second.script.emit(init());
    second.script.emit(result());
    second.script.end();
    await secondRun;
  });
});

test('a relay turn that outlasts the wait is interrupted before its stdin is closed', async () => {
  const previous = process.env.CLAUDE_HELD_TURN_WAIT_MS;
  process.env.CLAUDE_HELD_TURN_WAIT_MS = '1000';
  try {
    await withTwoRuns(async ({ first, second, sent, startFirst, startSecond }) => {
      const firstRun = startFirst();
      await settle();
      await holdForBackgroundCommand(first.script, sent);
      first.script.emit(taskNotification('b1', 'toolu_bg', 'completed'));
      first.script.emit(assistantText('Relaying, slowly.'));
      await settle();
      // An interrupted turn ends with its `result`, as the CLI's does.
      first.script.onInterrupt = () => { first.script.emit(result()); };

      // What the old process had been asked by the time the new one starts:
      // the release is done by then, and the supersede's own interrupt (sent
      // after stdin has ended, so dropped) has not happened yet.
      let callsAtTakeover: string[] | null = null;
      const createSecond = second.createQuery;
      second.createQuery = (options) => { callsAtTakeover = [...first.script.calls]; return createSecond(options); };
      const secondRun = startSecond();
      await waitFor(() => first.script.released());
      await waitFor(() => callsAtTakeover !== null);
      // Interrupted once, by the wait. The release does not interrupt again.
      assert.deepEqual(callsAtTakeover!.filter((call) => call === 'interrupt'), ['interrupt']);

      first.script.end();
      await firstRun;
      second.script.emit(init());
      second.script.emit(result());
      second.script.end();
      await secondRun;
    });
  } finally {
    if (previous === undefined) {
      delete process.env.CLAUDE_HELD_TURN_WAIT_MS;
    } else {
      process.env.CLAUDE_HELD_TURN_WAIT_MS = previous;
    }
  }
});

test('a relay turn that ignores the interrupt has its process closed', async () => {
  const previous = process.env.CLAUDE_HELD_TURN_WAIT_MS;
  process.env.CLAUDE_HELD_TURN_WAIT_MS = '1000';
  try {
    await withTwoRuns(async ({ first, second, sent, startFirst, startSecond }) => {
      const firstRun = startFirst();
      await settle();
      await holdForBackgroundCommand(first.script, sent);
      first.script.emit(taskNotification('b1', 'toolu_bg', 'completed'));
      first.script.emit(assistantText('Relaying, and never stopping.'));
      await settle();

      const secondRun = startSecond();
      // The wait's timers do not hold the event loop open, so poll for them.
      await waitFor(() => first.script.calls.includes('close'));
      await firstRun;
      assert.deepEqual(first.script.calls.slice(0, 2), ['interrupt', 'close']);
      assert.equal(hasActiveHeldTurn(SESSION_ID), false);

      second.script.emit(init());
      second.script.emit(result());
      second.script.end();
      await secondRun;
      assert.equal(second.script.released(), true, 'the new turn ran');
    });
  } finally {
    if (previous === undefined) {
      delete process.env.CLAUDE_HELD_TURN_WAIT_MS;
    } else {
      process.env.CLAUDE_HELD_TURN_WAIT_MS = previous;
    }
  }
});

test('a new turn interrupts the held process before taking over, for a turn the run has not seen start', async () => {
  await withTwoRuns(async ({ first, second, sent, startFirst, startSecond }) => {
    const firstRun = startFirst();
    await settle();
    await holdForBackgroundCommand(first.script, sent);
    // The CLI has started a turn of its own (a Monitor event, say) but has
    // written nothing yet, so the run cannot know the session is busy.
    assert.equal(hasActiveHeldTurn(SESSION_ID), false);

    // The release happens before the new process is created; the supersede's
    // interrupt comes after it, once stdin has ended, and is dropped by the
    // SDK. So the interrupt that counts is one already sent at creation.
    let callsAtTakeover: string[] | null = null;
    const createSecond = second.createQuery;
    second.createQuery = (options) => { callsAtTakeover = [...first.script.calls]; return createSecond(options); };
    const secondRun = startSecond();
    await waitFor(() => first.script.released());
    await waitFor(() => callsAtTakeover !== null);
    assert.ok(callsAtTakeover!.includes('interrupt'), 'the unseen turn is interrupted before the new process starts');
    assert.deepEqual(first.script.stopped, ['b1']);

    first.script.end();
    await firstRun;
    second.script.emit(init());
    second.script.emit(result());
    second.script.end();
    await secondRun;
  });
});

test('a closed held process gets to exit before the new turn starts', async () => {
  const previous = process.env.CLAUDE_HELD_TURN_WAIT_MS;
  process.env.CLAUDE_HELD_TURN_WAIT_MS = '1000';
  try {
    await withTwoRuns(async ({ first, second, sent, startFirst, startSecond }) => {
      const firstRun = startFirst();
      await settle();
      await holdForBackgroundCommand(first.script, sent);
      first.script.emit(taskNotification('b1', 'toolu_bg', 'completed'));
      first.script.emit(assistantText('Relaying, and never stopping.'));
      await settle();
      // The process takes a while to go after it is closed, as a CLI that is
      // SIGTERMed with a tool still running does.
      let exitNow: () => void = () => {};
      first.script.onClose = () => { exitNow = () => first.script.end(); };

      let secondCreated = false;
      const createSecond = second.createQuery;
      second.createQuery = (options) => { secondCreated = true; return createSecond(options); };
      const secondRun = startSecond();
      await waitFor(() => first.script.calls.includes('close'));
      await settle();
      await settle();
      assert.equal(secondCreated, false, 'the new process waits for the old one to exit');

      exitNow();
      await firstRun;
      await waitFor(() => secondCreated);
      second.script.emit(init());
      second.script.emit(result());
      second.script.end();
      await secondRun;
    });
  } finally {
    if (previous === undefined) {
      delete process.env.CLAUDE_HELD_TURN_WAIT_MS;
    } else {
      process.env.CLAUDE_HELD_TURN_WAIT_MS = previous;
    }
  }
});

test('the held-turn wait is clamped to what a timer can honour', () => {
  const previous = process.env.CLAUDE_HELD_TURN_WAIT_MS;
  const read = (value: string | undefined) => {
    if (value === undefined) {
      delete process.env.CLAUDE_HELD_TURN_WAIT_MS;
    } else {
      process.env.CLAUDE_HELD_TURN_WAIT_MS = value;
    }
    return readHeldTurnWaitMs();
  };
  try {
    assert.equal(read(undefined), 120_000);
    assert.equal(read(''), 120_000);
    assert.equal(read('abc'), 120_000);
    assert.equal(read('0'), 120_000);
    assert.equal(read('-5'), 120_000, 'a negative wait is not a wait');
    assert.equal(read('Infinity'), 120_000);
    assert.equal(read('50'), 1_000, 'raised to the floor');
    assert.equal(read('3e6'), 3_000_000, 'exponent notation reads as the number it is');
    assert.equal(read('99999999999'), 2_147_483_647, 'held below the timer overflow');
    assert.equal(read('300000'), 300_000);
  } finally {
    if (previous === undefined) {
      delete process.env.CLAUDE_HELD_TURN_WAIT_MS;
    } else {
      process.env.CLAUDE_HELD_TURN_WAIT_MS = previous;
    }
  }
});
