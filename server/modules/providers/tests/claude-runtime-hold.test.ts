import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ClaudeSessionsProvider } from '@/modules/providers/list/claude/claude-sessions.provider.js';
import { CLAUDE_PREDEFINED_MODELS } from '@/modules/providers/list/claude/claude-models.provider.js';
import {
  abortClaudeSDKSession,
  reconnectSessionWriter,
  resolveToolApproval,
  listClaudeSDKBackgroundWork,
  queryClaudeSDK,
  stopClaudeSDKTask,
} from '@/modules/providers/list/claude/claude-runtime.provider.js';
import type { NormalizedMessage, ProviderRuntimeContext } from '@/shared/index.js';

/** Drive the persistent SDK input and output streams without launching a CLI. */

const SESSION_ID = 'app-hold-session';
const NATIVE_ID = 'native-hold-session';

type Scripted = {
  emit: (message: Record<string, unknown>) => void;
  end: () => void;
  released: () => boolean;
  stopped: string[];
  prompts: Array<{ uuid: string }>;
  creations: number;
  options: Record<string, any>;
  interruptions: number;
  fail: (error: Error) => void;
};

/** A stand-in for the SDK query: yields what the test emits, and reads the held prompt to notice its release. */
function createScriptedQuery(): { createQuery: NonNullable<ProviderRuntimeContext['createQuery']>; script: Scripted } {
  const queue: Array<Record<string, unknown> | Error | null> = [];
  let wake: (() => void) | null = null;
  let released = false;
  const stopped: string[] = [];

  const script: Scripted = {
    emit: (message) => { queue.push(message); wake?.(); },
    end: () => { queue.push(null); wake?.(); },
    released: () => released,
    stopped,
    prompts: [],
    creations: 0,
    options: {},
    interruptions: 0,
    fail: (error) => { queue.push(error); wake?.(); },
  };

  const createQuery: NonNullable<ProviderRuntimeContext['createQuery']> = ({ prompt, options }) => {
    script.options = options;
    script.creations++;
    void (async () => {
      for await (const message of prompt) { script.prompts.push(message as { uuid: string }); }
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
        if (next instanceof Error) throw next;
        yield next;
      }
    })();

    return Object.assign(iterator, {
      interrupt: async () => { script.interruptions++; script.end(); },
      stopTask: async (taskId: string) => { stopped.push(taskId); },
    });
  };

  return { createQuery, script };
}

async function withRun(
  runTest: (context: { script: Scripted; sent: NormalizedMessage[]; done: Promise<unknown>; submit: (command: string, sent: NormalizedMessage[], overrides?: Record<string, unknown>) => Promise<unknown>; reconnects: unknown[] }) => Promise<void>,
): Promise<void> {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'claude-runtime-hold-'));
  const { createQuery, script } = createScriptedQuery();
  const sent: NormalizedMessage[] = [];
  const reconnects: unknown[] = [];
  const writer = { updateWebSocket: (socket: unknown) => { reconnects.push(socket); }, send: (message: NormalizedMessage) => { sent.push(message); }, userId: null };
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
    await until(() => script.prompts.length === 1);
    const submit = (command: string, output: NormalizedMessage[], overrides = {}) => queryClaudeSDK(command,
      { sessionId: SESSION_ID, cwd, ...overrides },
      { send: (message: unknown) => { output.push(message as NormalizedMessage); }, updateWebSocket: (socket: unknown) => { reconnects.push(socket); }, userId: null } as never, context);
    await runTest({ script, sent, done, submit, reconnects });
    script.end();
    await done;
  } finally {
    script.end();
    await abortClaudeSDKSession(SESSION_ID);
    await rm(cwd, { recursive: true, force: true });
  }
}

async function until(predicate: () => boolean) {
  const deadline = Date.now() + 3000;
  while (!predicate()) {
    if (Date.now() > deadline) assert.fail('Timed out waiting for runtime event');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

const settle = () => new Promise((resolve) => { setTimeout(resolve, 25); });

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
const result = (uuid?: string) => ({ user_message_uuid: uuid, type: 'result', subtype: 'success', session_id: NATIVE_ID, result: 'launched', duration_ms: 1, num_turns: 1 });

test('stopping the last task keeps the conversation available for reuse', async () => {
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
    assert.equal(script.released(), false, 'the idle conversation remains available');
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
    assert.equal(script.released(), false, 'the conversation survives the follow-up result');
  });
});

test('an agent settled before the result leaves no outstanding work', async () => {
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
    assert.equal(script.released(), false, 'idle conversations also survive turn completion');
  });
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

test('successive user turns reuse one query and ignore a late background result', async () => {
  await withRun(async ({ script, sent, submit }) => {
    script.emit(init());
    script.emit(taskStarted('a1', 'tool1', 'local_agent'));
    script.emit(taskStarted('a2', 'tool2', 'local_agent'));
    script.emit(result(script.prompts[0].uuid));
    await until(() => sent.some((message) => message.kind === 'complete'));
    const next: NormalizedMessage[] = [];
    const done = submit('next question', next);
    await until(() => script.prompts.length === 2);
    script.emit(taskNotification('a1', 'tool1', 'completed'));
    script.emit(result());
    await settle();
    assert.equal(next.some((message) => message.kind === 'complete'), false);
    assert.deepEqual(listClaudeSDKBackgroundWork()[0].tasks.map((task) => task.taskId), ['a2']);
    assert.equal(script.creations, 1);
    assert.equal(script.interruptions, 0);
    assert.equal(script.released(), false);
    script.emit(result(script.prompts[1].uuid));
    await done;
    assert.equal(next.filter((message) => message.kind === 'complete').length, 1);
    assert.equal(sent.filter((message) => message.kind === 'complete').length, 1);
  });
});

test('reconnect targets the writer of the most recent turn', async () => {
  await withRun(async ({ script, sent, submit, reconnects }) => {
    script.emit(init());
    script.emit(result(script.prompts[0].uuid));
    await until(() => sent.some((message) => message.kind === 'complete'));
    const next: NormalizedMessage[] = [];
    const done = submit('continue', next);
    await until(() => script.prompts.length === 2);
    const socket = { send() {}, readyState: 1 };
    assert.equal(reconnectSessionWriter(SESSION_ID, socket as never), true);
    assert.deepEqual(reconnects, [socket]);
    script.emit(result(script.prompts[1].uuid));
    await done;
  });
});

test('a query crash fails and settles the pending reused turn', async () => {
  await withRun(async ({ script, sent, submit }) => {
    script.emit(init());
    script.emit(result(script.prompts[0].uuid));
    await until(() => sent.some((message) => message.kind === 'complete'));
    const next: NormalizedMessage[] = [];
    const done = submit('continue', next);
    await until(() => script.prompts.length === 2);
    script.fail(new Error('scripted process failure'));
    await done;
    assert.ok(next.some((message) => message.kind === 'error'));
    assert.ok(next.some((message) => message.kind === 'complete' && message.exitCode === 1));
    assert.equal(script.released(), true);
  });
});

test('explicit abort releases the process and settles a pending reused turn', async () => {
  await withRun(async ({ script, sent, submit }) => {
    script.emit(init());
    script.emit(result(script.prompts[0].uuid));
    await until(() => sent.some((message) => message.kind === 'complete'));
    const next: NormalizedMessage[] = [];
    const done = submit('continue', next);
    await until(() => script.prompts.length === 2);
    assert.equal(await abortClaudeSDKSession(SESSION_ID), true);
    await done;
    assert.equal(script.interruptions, 1);
    assert.equal(script.released(), true);
    assert.equal(next.some((message) => message.kind === 'complete'), false, 'abort handler owns completion');
  });
});

test('changing startup settings preserves outstanding tasks', async () => {
  await withRun(async ({ script, sent, submit }) => {
    script.emit(init());
    script.emit(taskStarted('a1', 'tool1', 'local_agent'));
    script.emit(result(script.prompts[0].uuid));
    await until(() => sent.some((message) => message.kind === 'complete'));
    const next: NormalizedMessage[] = [];
    await submit('continue', next, { effort: 'high' });
    assert.ok(next.some((message) => message.kind === 'error'));
    assert.equal(script.prompts.length, 1);
    assert.equal(script.interruptions, 0);
    assert.equal(script.released(), false);
    assert.equal(listClaudeSDKBackgroundWork()[0].tasks.length, 1);
  });
});

test('permission requests after reuse reach the current turn writer', async () => {
  await withRun(async ({ script, sent, submit }) => {
    script.emit(init());
    script.emit(result(script.prompts[0].uuid));
    await until(() => sent.some((message) => message.kind === 'complete'));
    const next: NormalizedMessage[] = [];
    const done = submit('continue', next);
    await until(() => script.prompts.length === 2);
    const permission = script.options.canUseTool('AskUserQuestion', { question: 'Proceed?' }, { signal: new AbortController().signal });
    const request = next.find((message) => message.kind === 'permission_request');
    assert.ok(request?.requestId);
    assert.equal(sent.some((message) => message.kind === 'permission_request'), false);
    resolveToolApproval(request.requestId, { allow: true });
    assert.equal((await permission).behavior, 'allow');
    script.emit(result(script.prompts[1].uuid));
    await done;
  });
});

test('remembered permissions reuse the live query while client-only changes remain blocked', async () => {
  await withRun(async ({ script, sent, submit }) => {
    script.emit(init());
    script.emit(taskStarted('a1', 'tool1', 'local_agent'));
    const permission = script.options.canUseTool('Bash', { command: 'pwd' }, { signal: new AbortController().signal });
    const request = sent.find((message) => message.kind === 'permission_request');
    assert.ok(request?.requestId);
    resolveToolApproval(request.requestId, { allow: true, rememberEntry: 'Bash(pwd)' });
    assert.equal((await permission).behavior, 'allow');
    script.emit(result(script.prompts[0].uuid));
    await until(() => sent.some((message) => message.kind === 'complete'));

    const next: NormalizedMessage[] = [];
    const toolsSettings = { allowedTools: ['Bash(pwd)'], disallowedTools: [], skipPermissions: false };
    const done = submit('continue', next, { toolsSettings });
    await until(() => script.prompts.length === 2 || next.some((message) => message.kind === 'error'));
    assert.equal(script.prompts.length, 2, 'the remembered permission must not require a restart');
    script.emit(result(script.prompts[1].uuid));
    await done;
    for (const changed of [
      { ...toolsSettings, allowedTools: ['Bash(pwd)', 'Write'] },
      { ...toolsSettings, allowedTools: [] },
      { ...toolsSettings, disallowedTools: ['Bash(pwd)'] },
      { ...toolsSettings, skipPermissions: true },
    ]) {
      const refused: NormalizedMessage[] = [];
      await submit('change settings', refused, { toolsSettings: changed });
      assert.ok(refused.some((message) => message.kind === 'error'));
    }
    assert.equal(script.creations, 1);
    assert.equal(script.released(), false);
    assert.equal(script.interruptions, 0);
  });
});

test('explicit empty permission defaults match omitted settings', async () => {
  await withRun(async ({ script, sent, submit }) => {
    script.emit(init());
    script.emit(taskStarted('a1', 'tool1', 'local_agent'));
    script.emit(result(script.prompts[0].uuid));
    await until(() => sent.some((message) => message.kind === 'complete'));
    const next: NormalizedMessage[] = [];
    const done = submit('continue', next, { toolsSettings: { allowedTools: [], disallowedTools: [], skipPermissions: false } });
    await until(() => script.prompts.length === 2 || next.some((message) => message.kind === 'error'));
    assert.equal(script.prompts.length, 2);
    script.emit(result(script.prompts[1].uuid));
    await done;
    assert.equal(script.creations, 1);
  });
});

test('untracked work expires only after its lease and the normal idle timeout', async (t) => {
  await withRun(async ({ script, sent }) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const drain = () => new Promise<void>((resolve) => setImmediate(resolve));
    script.emit(init());
    script.emit(toolUse('monitor', 'Monitor', {}));
    script.emit(result(script.prompts[0].uuid));
    await drain();
    t.mock.timers.tick(24 * 60 * 60 * 1000 - 1);
    await drain();
    assert.equal(script.released(), false);
    t.mock.timers.tick(1);
    await drain();
    assert.equal(script.released(), false, 'expiry starts the normal idle grace period');
    assert.ok(sent.some((message) => message.kind === 'status' && message.text?.includes('silent for 24 hours')));
    t.mock.timers.tick(30 * 60 * 1000);
    await drain();
    assert.equal(script.released(), true);
    t.mock.timers.reset();
  });
});

test('automatic untracked activity renews the lease and exit cancels it', async (t) => {
  await withRun(async ({ script, sent, done }) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const drain = () => new Promise<void>((resolve) => setImmediate(resolve));
    script.emit(init());
    script.emit(toolUse('monitor', 'Monitor', {}));
    script.emit(result(script.prompts[0].uuid));
    await drain();
    t.mock.timers.tick(23 * 60 * 60 * 1000);
    script.emit({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Scheduled update' }] } });
    script.emit(result());
    await drain();
    t.mock.timers.tick(2 * 60 * 60 * 1000);
    await drain();
    assert.equal(script.released(), false, 'automatic activity renewed the unknown-work lease');
    assert.equal(sent.some((message) => message.kind === 'status' && message.text?.includes('silent for 24 hours')), false);
    script.end();
    await done;
    const messagesAtExit = sent.length;
    t.mock.timers.tick(48 * 60 * 60 * 1000);
    await drain();
    assert.equal(sent.length, messagesAtExit, 'no lease callback after query exit');
    t.mock.timers.reset();
  });
});

test('untracked expiry cannot release tracked tasks or their automatic follow-up', async (t) => {
  await withRun(async ({ script }) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const drain = () => new Promise<void>((resolve) => setImmediate(resolve));
    script.emit(init());
    script.emit(toolUse('monitor', 'Monitor', {}));
    script.emit(result(script.prompts[0].uuid));
    await drain();
    script.emit(taskStarted('a1', 'tool1', 'local_agent'));
    await drain();
    t.mock.timers.tick(25 * 60 * 60 * 1000);
    await drain();
    assert.equal(script.released(), false);
    script.emit(taskNotification('a1', 'tool1', 'completed'));
    await drain();
    t.mock.timers.tick(60 * 60 * 1000);
    await drain();
    assert.equal(script.released(), false);
    script.emit(result());
    await drain();
    t.mock.timers.tick(30 * 60 * 1000);
    await drain();
    assert.equal(script.released(), true);
    t.mock.timers.reset();
  });
});

test('untracked expiry cannot close an active user turn', async (t) => {
  await withRun(async ({ script, submit }) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const drain = () => new Promise<void>((resolve) => setImmediate(resolve));
    script.emit(init());
    script.emit(toolUse('monitor', 'Monitor', {}));
    script.emit(result(script.prompts[0].uuid));
    await drain();
    const next: NormalizedMessage[] = [];
    const done = submit('continue', next);
    await drain();
    assert.equal(script.prompts.length, 2);
    t.mock.timers.tick(25 * 60 * 60 * 1000);
    await drain();
    assert.equal(script.released(), false);
    script.emit(result(script.prompts[1].uuid));
    await done;
    t.mock.timers.tick(30 * 60 * 1000);
    await drain();
    assert.equal(script.released(), true);
    t.mock.timers.reset();
  });
});

test('idle timeout never closes active tasks or their pending follow-up turn', async (t) => {
  await withRun(async ({ script, sent }) => {
    script.emit(init());
    script.emit(taskStarted('a1', 'tool1', 'local_agent'));
    script.emit(result(script.prompts[0].uuid));
    await until(() => sent.some((message) => message.kind === 'complete'));
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const drain = () => new Promise<void>((resolve) => setImmediate(resolve));
    t.mock.timers.tick(31 * 60 * 1000);
    await drain();
    assert.equal(script.released(), false);
    script.emit(taskNotification('a1', 'tool1', 'completed'));
    await drain();
    t.mock.timers.tick(31 * 60 * 1000);
    await drain();
    assert.equal(script.released(), false, 'wait for the automatic follow-up result');
    script.emit(result());
    await drain();
    t.mock.timers.tick(31 * 60 * 1000);
    await drain();
    assert.equal(script.released(), true, 'reclaim a conversation only after it becomes idle');
    t.mock.timers.reset();
  });
});

test('unexpected EOF fails a pending turn instead of reporting success', async () => {
  await withRun(async ({ script, sent, done }) => {
    script.emit(init());
    script.end();
    await done;
    assert.ok(sent.some((message) => message.kind === 'complete' && message.exitCode === 1));
  });
});

test('concurrent setup cannot supersede a session and setup can be aborted', async () => {
  const { createQuery, script } = createScriptedQuery();
  let finishSetup!: () => void;
  const setup = new Promise<void>((resolve) => { finishSetup = resolve; });
  const sent: NormalizedMessage[] = [];
  const context: ProviderRuntimeContext = {
    resolveProviderSessionId: () => null,
    resolveResumeModel: async () => { await setup; return undefined; },
    getProviderModels: async () => CLAUDE_PREDEFINED_MODELS as never,
    normalizeMessage: () => [],
    isProviderInstalled: async () => true,
    createQuery,
  };
  const writer = { send: (message: unknown) => sent.push(message as NormalizedMessage) };
  const options = { sessionId: SESSION_ID, cwd: os.tmpdir() };
  const first = queryClaudeSDK('first', options, writer, context);
  await queryClaudeSDK('second', options, writer, context);
  assert.ok(sent.some((message) => message.kind === 'complete' && message.exitCode === 1));
  assert.equal(await abortClaudeSDKSession(SESSION_ID), true);
  finishSetup();
  await first;
  assert.equal(script.creations, 0);
  assert.equal(sent.filter((message) => message.kind === 'complete').length, 1);
});
