import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ClaudeSessionsProvider } from '@/modules/providers/list/claude/claude-sessions.provider.js';
import { CLAUDE_PREDEFINED_MODELS } from '@/modules/providers/list/claude/claude-models.provider.js';
import { queryClaudeSDK, resolveToolApproval } from '@/modules/providers/list/claude/claude-runtime.provider.js';
import type { NormalizedMessage, ProviderRuntimeContext } from '@/shared/types.js';

/**
 * What the model is told, and whether the turn stops, when the user refuses a
 * tool in the permission prompt. The runtime's `canUseTool` is taken from the
 * options handed to `context.createQuery`, called the way the SDK calls it, and
 * answered through `resolveToolApproval` the way `chat.permission-response` is.
 */

const SESSION_ID = 'app-denial-session';
const NATIVE_ID = 'native-denial-session';

type CanUseTool = (
  toolName: string,
  input: Record<string, unknown>,
  options: { signal: AbortSignal; toolUseID: string; agentID?: string },
) => Promise<Record<string, unknown>>;

type Harness = {
  canUseTool: CanUseTool;
  sent: NormalizedMessage[];
  emit: (message: Record<string, unknown>) => void;
  fail: (error: Error) => void;
  end: () => void;
  done: Promise<unknown>;
};

async function withRun(runTest: (harness: Harness) => Promise<void>): Promise<void> {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'claude-permission-denial-'));
  const queue: Array<{ message?: Record<string, unknown>; error?: Error; end?: true }> = [];
  let wake: (() => void) | null = null;
  const push = (item: { message?: Record<string, unknown>; error?: Error; end?: true }) => { queue.push(item); wake?.(); };
  let canUseTool: CanUseTool | null = null;

  const createQuery: NonNullable<ProviderRuntimeContext['createQuery']> = ({ prompt, options }) => {
    canUseTool = options.canUseTool as CanUseTool;
    void (async () => { for await (const _message of prompt) { /* the CLI reads its stdin */ } })();
    const iterator = (async function* () {
      for (;;) {
        const next = queue.shift();
        if (!next) {
          await new Promise<void>((resolve) => { wake = resolve; });
          wake = null;
          continue;
        }
        if (next.error) {
          throw next.error;
        }
        if (next.end) {
          return;
        }
        yield next.message;
      }
    })();
    return Object.assign(iterator, { interrupt: async () => {} });
  };

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
    while (!canUseTool) {
      await settle();
    }
    await runTest({
      canUseTool,
      sent,
      emit: (message) => push({ message }),
      fail: (error) => push({ error }),
      end: () => push({ end: true }),
      done,
    });
    push({ end: true });
    await done;
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

const settle = () => new Promise((resolve) => { setTimeout(resolve, 10); });

/** Calls canUseTool like the SDK does and answers the prompt it raises. */
async function decide(
  harness: Harness,
  toolName: string,
  decision: { allow: boolean; message?: string; updatedInput?: unknown },
  agentID?: string,
): Promise<Record<string, unknown>> {
  const before = harness.sent.length;
  const pending = harness.canUseTool(toolName, { command: 'rm -rf build' }, {
    signal: new AbortController().signal,
    toolUseID: 'toolu_1',
    agentID,
  });
  await settle();
  const request = harness.sent.slice(before).find((message) => message.kind === 'permission_request');
  assert.ok(request, 'the prompt reaches the client');
  resolveToolApproval(request.requestId as string, decision);
  return pending;
}

test('a bare denial stops the turn and tells the model which tool was refused', async () => {
  await withRun(async (harness) => {
    const result = await decide(harness, 'Bash', { allow: false });

    assert.equal(result.behavior, 'deny');
    assert.equal(result.interrupt, true);
    assert.match(String(result.message), /denied permission to use Bash/);
    assert.match(String(result.message), /STOP what you are doing/);
  });
});

test('a denial with a reason keeps the turn going and relays the reason', async () => {
  await withRun(async (harness) => {
    const result = await decide(harness, 'Bash', { allow: false, message: '  use the staging bucket instead  ' });

    assert.equal(result.behavior, 'deny');
    assert.equal(result.interrupt, false);
    assert.match(String(result.message), /denied permission to use Bash/);
    assert.match(String(result.message), /the user said:\nuse the staging bucket instead$/);
  });
});

test('a whitespace-only reason counts as a bare denial', async () => {
  await withRun(async (harness) => {
    const result = await decide(harness, 'WebSearch', { allow: false, message: '   ' });

    assert.equal(result.interrupt, true);
    assert.match(String(result.message), /denied permission to use WebSearch/);
  });
});

test('a bare denial of a subagent call does not interrupt, as in the CLI', async () => {
  await withRun(async (harness) => {
    const result = await decide(harness, 'Bash', { allow: false }, 'agent-1');

    assert.equal(result.interrupt, false);
    assert.match(String(result.message), /STOP what you are doing/);
  });
});

test('interactive tools keep their reply verbatim and never interrupt', async () => {
  await withRun(async (harness) => {
    const result = await decide(harness, 'ExitPlanMode', { allow: false, message: 'User asked to revise the plan' });

    assert.deepEqual(result, { behavior: 'deny', message: 'User asked to revise the plan' });
  });
});

test('allowing is unchanged', async () => {
  await withRun(async (harness) => {
    const result = await decide(harness, 'Bash', { allow: true });

    assert.deepEqual(result, { behavior: 'allow', updatedInput: { command: 'rm -rf build' } });
  });
});

test('the turn a denial stopped ends quietly, without an error row', async () => {
  await withRun(async (harness) => {
    harness.emit({ type: 'system', subtype: 'init', session_id: NATIVE_ID });
    await decide(harness, 'Bash', { allow: false });

    // What the CLI does after `interrupt`: an error result for the turn, then
    // it exits non-zero and the SDK rethrows that result from the iterator.
    harness.emit({
      type: 'result', subtype: 'error_during_execution', is_error: true, session_id: NATIVE_ID,
      errors: ['[ede_diagnostic] result_type=user last_content_type=n/a stop_reason=tool_use'],
    });
    harness.fail(new Error('Claude Code returned an error result: [ede_diagnostic] result_type=user'));
    await harness.done;

    const completes = harness.sent.filter((message) => message.kind === 'complete');
    assert.equal(completes.length, 1);
    assert.equal(completes[0].exitCode, 0);
    assert.deepEqual(harness.sent.filter((message) => message.kind === 'error'), []);
  });
});

test('a failure that is not a denial stop is still reported', async () => {
  await withRun(async (harness) => {
    harness.emit({ type: 'system', subtype: 'init', session_id: NATIVE_ID });
    await decide(harness, 'Bash', { allow: false, message: 'try the other script' });

    harness.emit({ type: 'result', subtype: 'error_during_execution', is_error: true, session_id: NATIVE_ID, errors: ['boom'] });
    harness.fail(new Error('Claude Code returned an error result: boom'));
    await harness.done;

    const errors = harness.sent.filter((message) => message.kind === 'error');
    assert.equal(errors.length, 1);
    assert.match(String(errors[0].content), /boom/);
  });
});
