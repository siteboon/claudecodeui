import assert from 'node:assert/strict';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ClaudeSessionsProvider } from '@/modules/providers/list/claude/claude-sessions.provider.js';
import { CLAUDE_PREDEFINED_MODELS } from '@/modules/providers/list/claude/claude-models.provider.js';
import {
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
  /** The options the runtime handed the SDK's `query`. */
  options: () => Record<string, unknown> | null;
  /** Settles once the runtime has built its query, i.e. finished setting the turn up. */
  created: Promise<void>;
};

/** A stand-in for the SDK query: yields what the test emits, and reads the held prompt to notice its release. */
function createScriptedQuery(): { createQuery: NonNullable<ProviderRuntimeContext['createQuery']>; script: Scripted } {
  const queue: Array<Record<string, unknown> | null> = [];
  let wake: (() => void) | null = null;
  let released = false;
  let options: Record<string, unknown> | null = null;
  let markCreated: () => void = () => {};
  const created = new Promise<void>((resolve) => { markCreated = resolve; });
  const stopped: string[] = [];

  const script: Scripted = {
    emit: (message) => { queue.push(message); wake?.(); },
    end: () => { queue.push(null); wake?.(); },
    released: () => released,
    stopped,
    options: () => options,
    created,
  };

  const createQuery: NonNullable<ProviderRuntimeContext['createQuery']> = ({ prompt, options: queryOptions }) => {
    options = queryOptions;
    markCreated();
    void (async () => {
      for await (const _message of prompt) { /* the CLI reads its stdin */ }
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
    // Setup asks the CLI for its version before building the query; wait it out
    // so the scripted stream is read from the start.
    await script.created;
    await runTest({ script, sent, done });
    script.end();
    await done;
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

// Captured before any test mocks the timers, so waiting for the stream keeps working.
const realSetTimeout = setTimeout;
const settle = () => new Promise((resolve) => { realSetTimeout(resolve, 25); });

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

const hookStarted = (hookId: string, hookEvent: string) => ({
  type: 'system', subtype: 'hook_started', session_id: NATIVE_ID, hook_id: hookId, hook_name: hookEvent, hook_event: hookEvent,
});
const hookResponse = (hookId: string, hookEvent: string) => ({
  type: 'system', subtype: 'hook_response', session_id: NATIVE_ID, hook_id: hookId, hook_name: hookEvent, hook_event: hookEvent,
  output: '', stdout: '', stderr: '', exit_code: 0, outcome: 'success',
});

test('an async hook still running when the turn ends keeps the process up for a bounded grace', async (t) => {
  await withRun(async ({ script, sent }) => {
    // Stop hooks run just before the result: the sync one has finished, the
    // `async: true` one is still going. The CLI kills it when it exits.
    script.emit(init());
    script.emit(hookStarted('hook_sync', 'Stop'));
    script.emit(hookResponse('hook_sync', 'Stop'));
    script.emit(hookStarted('hook_async', 'Stop'));
    await settle();

    t.mock.timers.enable({ apis: ['setTimeout'] });
    script.emit(result());
    await settle();

    assert.ok(sent.some((message) => message.kind === 'complete'), 'the client still hears the turn is over at once');
    assert.equal(script.released(), false, 'stdin stays open so the async hook can finish');

    t.mock.timers.tick(1000);
    await settle();
    assert.equal(script.released(), false);

    t.mock.timers.tick(10 * 60 * 1000);
    await settle();
    assert.equal(script.released(), true, 'the grace ends on its own');
  });
});

test('the async-hook grace ends as soon as the last running hook reports back', async () => {
  await withRun(async ({ script }) => {
    script.emit(init());
    script.emit(hookStarted('hook_async', 'Stop'));
    script.emit(result());
    await settle();
    assert.equal(script.released(), false);

    script.emit(hookResponse('hook_async', 'Stop'));
    await settle();
    assert.equal(script.released(), true);
  });
});

test('a turn whose hooks all finished releases the process at its result', async () => {
  await withRun(async ({ script }) => {
    script.emit(init());
    script.emit(hookStarted('hook_prompt', 'UserPromptSubmit'));
    script.emit(hookResponse('hook_prompt', 'UserPromptSubmit'));
    script.emit(hookStarted('hook_stop', 'Stop'));
    script.emit(hookResponse('hook_stop', 'Stop'));
    script.emit(result());
    await settle();

    assert.equal(script.released(), true, 'nothing is running, so nothing to wait for');
  });
});

test('hook events are only requested from a CLI new enough to accept the flag', { skip: process.platform === 'win32' }, async () => {
  const binDir = await mkdtemp(path.join(os.tmpdir(), 'claude-runtime-hold-cli-'));
  const fakeCli = async (name: string, body: string) => {
    const file = path.join(binDir, name);
    await writeFile(file, `#!/bin/sh\n${body}\n`);
    await chmod(file, 0o755);
    return file;
  };
  const previous = process.env.CLAUDE_CLI_PATH;
  const includeHookEventsWith = async (cliPath: string) => {
    process.env.CLAUDE_CLI_PATH = cliPath;
    let requested: unknown;
    await withRun(async ({ script }) => {
      requested = script.options()?.includeHookEvents;
    });
    return requested;
  };

  try {
    // 2.1.88 does not exist on npm; 2.1.87 is the last release without the flag.
    assert.equal(await includeHookEventsWith(await fakeCli('old', 'echo "2.1.87 (Claude Code)"')), undefined);
    assert.equal(await includeHookEventsWith(await fakeCli('first', 'echo "2.1.89 (Claude Code)"')), true);
    assert.equal(await includeHookEventsWith(await fakeCli('current', 'echo "2.1.280 (Claude Code)"')), true);
    assert.equal(await includeHookEventsWith(await fakeCli('broken', 'exit 1')), undefined, 'a CLI that cannot say its version is treated as too old');
  } finally {
    if (previous === undefined) {
      delete process.env.CLAUDE_CLI_PATH;
    } else {
      process.env.CLAUDE_CLI_PATH = previous;
    }
    await rm(binDir, { recursive: true, force: true });
  }
});
