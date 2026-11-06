import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ClaudeSessionsProvider } from '@/modules/providers/list/claude/claude-sessions.provider.js';
import { CLAUDE_PREDEFINED_MODELS } from '@/modules/providers/list/claude/claude-models.provider.js';
import {
  backgroundClaudeSDKTasks,
  canContinueClaudeSDKSession,
  listClaudeSDKBackgroundWork,
  queryClaudeSDK,
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
  /** Every user record the CLI read from its stdin, in order. */
  prompts: Array<Record<string, any>>;
  /** Each `backgroundTasks` call's tool_use id (undefined = all). */
  backgrounded: Array<string | undefined>;
  /** Each live permission-mode change. */
  modes: string[];
};

/** A stand-in for the SDK query: yields what the test emits, and reads the held prompt to notice its release. */
function createScriptedQuery(): { createQuery: NonNullable<ProviderRuntimeContext['createQuery']>; script: Scripted } {
  const queue: Array<Record<string, unknown> | null> = [];
  let wake: (() => void) | null = null;
  let released = false;
  const stopped: string[] = [];
  const prompts: Array<Record<string, any>> = [];
  const backgrounded: Array<string | undefined> = [];
  const modes: string[] = [];

  const script: Scripted = {
    emit: (message) => { queue.push(message); wake?.(); },
    end: () => { queue.push(null); wake?.(); },
    released: () => released,
    stopped,
    prompts,
    backgrounded,
    modes,
  };

  const createQuery: NonNullable<ProviderRuntimeContext['createQuery']> = ({ prompt }) => {
    void (async () => {
      for await (const message of prompt) { prompts.push(message as Record<string, any>); }
      released = true;
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
      interrupt: async () => {},
      stopTask: async (taskId: string) => { stopped.push(taskId); },
      backgroundTasks: async (toolUseId?: string) => { backgrounded.push(toolUseId); return true; },
      setPermissionMode: async (mode: string) => { modes.push(mode); },
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
    await waitFor(() => sent.some((message) => message.kind === 'complete'));

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
  await withRun(async ({ script, sent }) => {
    script.emit(init());
    script.emit(toolUse('toolu_wf', 'Workflow', { script: 'export const meta = {}' }));
    script.emit(taskStarted('wf1', 'toolu_wf', 'local_workflow'));
    script.emit(ack('toolu_wf', 'Workflow launched in background. Task ID: wf1', { status: 'async_launched', taskId: 'wf1', taskType: 'local_workflow' }));
    script.emit(result());
    await waitFor(() => sent.some((message) => message.kind === 'complete'));

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
    await waitFor(() => script.released());

    assert.deepEqual(listClaudeSDKBackgroundWork(), []);
    assert.equal(script.released(), true, 'nothing is outstanding, so nothing to hold for');
  });
});

test('an edit sent while the process is held stops the tasks the held process still has going before letting it go', async () => {
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
    const firstRun = queryClaudeSDK('start an agent', { sessionId: SESSION_ID, cwd, model: 'opus' }, writer as never, { ...context, createQuery: first.createQuery });
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
    const secondRun = queryClaudeSDK('Continue', { sessionId: SESSION_ID, cwd, resumeAnchorId: 'anchor-1' }, writer as never, { ...context, createQuery: second.createQuery });
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

test('a held process is still let go when stopping its tasks throws (an edit)', async () => {
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
    const firstRun = queryClaudeSDK('start an agent', { sessionId: SESSION_ID, cwd, model: 'opus' }, writer as never, { ...context, createQuery: throwingStop });
    await settle();
    first.script.emit(init());
    first.script.emit(toolUse('toolu_agent', 'Agent', { prompt: 'sleep 90', subagent_type: 'general-purpose', run_in_background: true }));
    first.script.emit(taskStarted('a1', 'toolu_agent', 'local_agent'));
    first.script.emit(ack('toolu_agent', 'Async agent launched successfully.', { status: 'async_launched', agentId: 'a1' }));
    first.script.emit(result());
    await waitFor(() => sent.some((message) => message.kind === 'complete'));
    assert.equal(first.script.released(), false, 'the first process is held for its agent');

    const secondRun = queryClaudeSDK('Continue', { sessionId: SESSION_ID, cwd, resumeAnchorId: 'anchor-1' }, writer as never, { ...context, createQuery: second.createQuery });
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

/** A held run plus a second writer, for the hand-over tests below. */
async function startHeldForAgent(): Promise<{
  cwd: string;
  script: Scripted;
  firstSent: NormalizedMessage[];
  context: ProviderRuntimeContext;
  firstRun: Promise<unknown>;
}> {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'claude-runtime-hold-'));
  const { createQuery, script } = createScriptedQuery();
  const firstSent: NormalizedMessage[] = [];
  const firstWriter = { send: (message: NormalizedMessage) => { firstSent.push(message); }, userId: null };
  const sessions = new ClaudeSessionsProvider({ getLiveRunStartTime: () => null });
  const context: ProviderRuntimeContext = {
    resolveProviderSessionId: () => null,
    resolveResumeModel: async () => undefined,
    getProviderModels: async () => CLAUDE_PREDEFINED_MODELS as never,
    normalizeMessage: (raw, sessionId) => sessions.normalizeMessage(raw, sessionId),
    isProviderInstalled: async () => true,
    createQuery,
  };
  const firstRun = queryClaudeSDK('start an agent', { sessionId: SESSION_ID, cwd, model: 'opus' }, firstWriter as never, context);
  await settle();
  script.emit(init());
  script.emit(toolUse('toolu_agent', 'Agent', { prompt: 'sleep 90', subagent_type: 'general-purpose', run_in_background: true }));
  script.emit(taskStarted('a1', 'toolu_agent', 'local_agent'));
  script.emit(ack('toolu_agent', 'Async agent launched successfully.', { status: 'async_launched', agentId: 'a1' }));
  script.emit(result());
  await waitFor(() => firstSent.some((message) => message.kind === 'complete'));
  return { cwd, script, firstSent, context, firstRun };
}

test('a message sent while only background work runs goes to the same process, and the work keeps going', async () => {
  const { cwd, script, firstSent, context, firstRun } = await startHeldForAgent();
  try {
    assert.equal(canContinueClaudeSDKSession(SESSION_ID), true, 'the held process can take the next turn');
    const secondSent: NormalizedMessage[] = [];
    const secondWriter = { send: (message: NormalizedMessage) => { secondSent.push(message); }, userId: null };

    // Same model (or none named): the turn is handed to the running process.
    let secondDone = false;
    const secondRun = queryClaudeSDK('how is it going?', { sessionId: SESSION_ID, cwd, model: 'opus' }, secondWriter as never, context)
      .then(() => { secondDone = true; });
    await waitFor(() => script.prompts.length === 2);

    assert.deepEqual(script.stopped, [], 'the background agent is not stopped');
    assert.equal(script.released(), false, 'the process is not let go');
    assert.equal(JSON.stringify(script.prompts[1]).includes('how is it going?'), true, 'the new message reached the same CLI');
    assert.deepEqual(listClaudeSDKBackgroundWork().map((entry) => entry.sessionId), [SESSION_ID], 'the agent is still tracked');
    assert.equal(secondDone, false, 'the handed-over turn runs until the CLI ends it');

    // The CLI answers in that process; the reply and its end go to the new turn's writer.
    script.emit({ type: 'assistant', session_id: NATIVE_ID, parent_tool_use_id: null, message: { role: 'assistant', content: [{ type: 'text', text: 'still running' }] } });
    script.emit(result());
    await waitFor(() => secondDone);
    assert.ok(secondSent.some((message) => message.kind === 'complete'), 'the new turn ends on its own writer');
    assert.equal(firstSent.filter((message) => message.kind === 'complete').length, 1, 'the first turn is not completed twice');
    assert.equal(script.released(), false, 'still held: the agent has not reported yet');

    // The agent reports back later in that same process, and only then is it let go.
    script.emit(taskNotification('a1', 'toolu_agent', 'completed'));
    script.emit(result());
    await waitFor(() => script.released());
    script.end();
    await Promise.all([firstRun, secondRun]);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('Ctrl+B asks the running turn to move its foreground tasks to the background, and only a running turn', async () => {
  await withRun(async ({ script, sent }) => {
    script.emit(init());
    script.emit(toolUse('toolu_sleep', 'Bash', { command: 'sleep 600' }));
    await waitFor(() => sent.length > 0);

    assert.equal(await backgroundClaudeSDKTasks(SESSION_ID), true);
    assert.equal(await backgroundClaudeSDKTasks(SESSION_ID, 'toolu_sleep'), true);
    assert.deepEqual(script.backgrounded, [undefined, 'toolu_sleep']);

    script.emit(result());
    await waitFor(() => sent.some((message) => message.kind === 'complete'));
    assert.equal(await backgroundClaudeSDKTasks(SESSION_ID), false, 'a finished turn has nothing in the foreground');
    assert.equal(await backgroundClaudeSDKTasks('no-such-session'), false);
    assert.deepEqual(script.backgrounded, [undefined, 'toolu_sleep']);
  });
});

test('a message sent while the CLI relays a finished agent waits for that relay, so its result cannot end the new turn', async () => {
  const { cwd, script, context, firstRun } = await startHeldForAgent();
  try {
    // The agent finishes and the CLI starts its own turn to relay the result.
    script.emit(taskNotification('a1', 'toolu_agent', 'completed'));
    script.emit({ type: 'assistant', session_id: NATIVE_ID, parent_tool_use_id: null, message: { role: 'assistant', content: [{ type: 'text', text: 'the agent is done' }] } });
    await settle();

    const secondSent: NormalizedMessage[] = [];
    const secondWriter = { send: (message: NormalizedMessage) => { secondSent.push(message); }, userId: null };
    let secondDone = false;
    const secondRun = queryClaudeSDK('user question', { sessionId: SESSION_ID, cwd, model: 'opus' }, secondWriter as never, context)
      .then(() => { secondDone = true; });
    await settle();
    assert.equal(script.prompts.length, 1, 'not pushed while the relay turn runs');

    // The relay ends: nothing is outstanding any more, yet stdin stays open for the waiting turn.
    script.emit(result());
    await waitFor(() => script.prompts.length === 2);
    assert.equal(script.released(), false);
    assert.equal(secondDone, false, 'the relay result did not end the new turn');
    assert.equal(secondSent.some((message) => message.kind === 'complete'), false);

    // The new turn's own result ends it, and with nothing left the process goes.
    script.emit(result());
    await waitFor(() => secondDone);
    assert.ok(secondSent.some((message) => message.kind === 'complete'));
    await waitFor(() => script.released());
    script.end();
    await Promise.all([firstRun, secondRun]);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('stopping the background agent during a handed-over turn does not close stdin under that turn', async () => {
  const { cwd, script, context, firstRun } = await startHeldForAgent();
  try {
    const secondWriter = { send: () => {}, userId: null };
    let secondDone = false;
    const secondRun = queryClaudeSDK('user question', { sessionId: SESSION_ID, cwd, model: 'opus' }, secondWriter as never, context)
      .then(() => { secondDone = true; });
    await waitFor(() => script.prompts.length === 2);
    script.emit(toolUse('toolu_x', 'Bash', { command: 'ls' }));
    script.emit(taskNotification('a1', 'toolu_agent', 'stopped'));
    await settle();
    assert.equal(script.released(), false, 'stdin stays open while the turn runs');
    assert.equal(secondDone, false);

    script.emit(result());
    await waitFor(() => secondDone);
    await waitFor(() => script.released());
    script.end();
    await Promise.all([firstRun, secondRun]);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('a handed-over turn uses its own permission mode, not the one the process started with', async () => {
  const { cwd, script, context, firstRun } = await startHeldForAgent();
  try {
    const modes: string[] = [];
    // The scripted process records the live mode change the hand-over makes.
    const secondWriter = { send: () => {}, userId: null };
    const secondRun = queryClaudeSDK('rm the build folder', { sessionId: SESSION_ID, cwd, model: 'opus', permissionMode: 'default' }, secondWriter as never, {
      ...context,
    });
    await waitFor(() => script.prompts.length === 2);
    modes.push(...script.modes);
    assert.deepEqual(modes, ['default']);
    script.emit(result());
    script.emit(taskNotification('a1', 'toolu_agent', 'completed'));
    script.emit(result());
    script.end();
    await Promise.all([firstRun, secondRun]);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
