import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';

import { ClaudeSessionsProvider } from '@/modules/providers/list/claude/claude-sessions.provider.js';
import { CLAUDE_PREDEFINED_MODELS } from '@/modules/providers/list/claude/claude-models.provider.js';
import { queryClaudeSDK, resolveToolApproval } from '@/modules/providers/list/claude/claude-runtime.provider.js';
import type { NormalizedMessage, ProviderRuntimeContext } from '@/shared/types.js';

/**
 * Issue #607: a Claude permission prompt nobody answered was denied after a
 * hard-coded 55 s ("Permission request timed out"), while the Claude Code CLI
 * itself waits for as long as it takes. The prompt now waits indefinitely
 * unless the user turned a timeout on in Settings, which reaches the runtime
 * as `toolsSettings.permissionPromptTimeoutMs` with every run.
 *
 * These drive the real `canUseTool` through `queryClaudeSDK`'s
 * `context.createQuery` seam, so they cover how the setting is read from the
 * run options, not just the helper that normalizes it.
 */

type CanUseTool = (
  toolName: string,
  input: Record<string, unknown>,
  context: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

type PromptRun = {
  canUseTool: CanUseTool;
  sent: NormalizedMessage[];
};

/** Captures the `canUseTool` the runtime hands the SDK and keeps the run open until `end`. */
function createCapturingQuery() {
  let capture: ((canUseTool: CanUseTool) => void) | null = null;
  // Resolves once the runtime has finished its async setup and built the SDK options.
  const canUseTool = new Promise<CanUseTool>((resolve) => { capture = resolve; });
  let finish: (() => void) | null = null;
  const ended = new Promise<void>((resolve) => { finish = resolve; });

  const createQuery: NonNullable<ProviderRuntimeContext['createQuery']> = ({ prompt, options }) => {
    capture?.(options.canUseTool as CanUseTool);
    void (async () => { for await (const _message of prompt) { /* the CLI reads its stdin */ } })();
    // Yields nothing: the run only has to stay open while prompts are answered.
    const iterator: AsyncIterableIterator<unknown> = {
      [Symbol.asyncIterator]() { return this; },
      async next() { await ended; return { done: true, value: undefined }; },
    };
    return Object.assign(iterator, { interrupt: async () => {} });
  };

  return { createQuery, canUseTool, end: () => finish?.() };
}

let runCounter = 0;

/** Starts a run with the given `toolsSettings` and hands the test its permission callback. */
async function withPromptRun(
  toolsSettings: Record<string, unknown> | undefined,
  runTest: (run: PromptRun) => Promise<void>,
): Promise<void> {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'claude-permission-timeout-'));
  const { createQuery, canUseTool, end } = createCapturingQuery();
  const sent: NormalizedMessage[] = [];
  // No userId: the action_required notification short-circuits before touching the database.
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

  runCounter += 1;
  const options = { sessionId: `permission-timeout-${runCounter}`, cwd, toolsSettings };
  const done = queryClaudeSDK('touch a file', options, writer as never, context);
  try {
    await runTest({ canUseTool: await canUseTool, sent });
  } finally {
    // Answer anything a failed assertion left open, so no prompt timer outlives the test.
    for (const message of sent as SentWithRequest[]) {
      if (message.kind === 'permission_request' && message.requestId) {
        resolveToolApproval(message.requestId, { allow: false });
      }
    }
    end();
    await done;
    await rm(cwd, { recursive: true, force: true });
  }
}

type SentWithRequest = NormalizedMessage & { requestId?: string; toolName?: string; reason?: string };

const requestIdFor = (sent: NormalizedMessage[], toolName: string): string => {
  const request = (sent as SentWithRequest[]).find(
    (message) => message.kind === 'permission_request' && message.toolName === toolName,
  );
  assert.ok(request?.requestId, `the ${toolName} prompt reached the client`);
  return request.requestId;
};

const cancellations = (sent: NormalizedMessage[]) => (sent as SentWithRequest[])
  .filter((message) => message.kind === 'permission_cancelled');

/** Lets the promise chain behind a fired (or answered) prompt settle. */
const flush = () => new Promise<void>((resolve) => { setImmediate(resolve); });

/** Tracks a pending `canUseTool` call without awaiting it. */
function track(pending: Promise<Record<string, unknown>>) {
  const state: { decision: Record<string, unknown> | null } = { decision: null };
  void pending.then((decision) => { state.decision = decision; });
  return state;
}

const ONE_HOUR_MS = 60 * 60 * 1000;
const BASH_INPUT = { command: 'touch scratch-607.txt' };

for (const [label, toolsSettings] of [
  ['no tools settings at all', undefined],
  ['settings saved before the option existed', { allowedTools: [], disallowedTools: [], skipPermissions: false }],
  ['an explicit 0', { permissionPromptTimeoutMs: 0 }],
  ['an unusable value', { permissionPromptTimeoutMs: '60000' }],
] as const) {
  test(`an unanswered prompt waits for the user with ${label}`, async (t: TestContext) => {
    await withPromptRun(toolsSettings as Record<string, unknown> | undefined, async ({ canUseTool, sent }) => {
      t.mock.timers.enable({ apis: ['setTimeout'] });
      const prompt = track(canUseTool('Bash', BASH_INPUT, {}));
      await flush();

      // Far past the 55 s the runtime used to give up after.
      t.mock.timers.tick(ONE_HOUR_MS);
      await flush();
      assert.equal(prompt.decision, null, 'the prompt is still waiting for an answer');
      assert.deepEqual(cancellations(sent), [], 'nothing retracted the prompt');

      // A late answer still lands, and is announced so other tabs drop the prompt.
      resolveToolApproval(requestIdFor(sent, 'Bash'), { allow: true });
      await flush();
      assert.deepEqual(prompt.decision, { behavior: 'allow', updatedInput: BASH_INPUT });
      assert.ok(sent.some((message) => message.kind === 'permission_resolved'));
      t.mock.timers.reset();
    });
  });
}

test('a timeout set in Settings denies an unanswered prompt once it elapses', async (t: TestContext) => {
  await withPromptRun({ permissionPromptTimeoutMs: 50 }, async ({ canUseTool, sent }) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const prompt = track(canUseTool('Bash', BASH_INPUT, {}));
    await flush();

    t.mock.timers.tick(49);
    await flush();
    assert.equal(prompt.decision, null, 'still waiting 1 ms before the configured timeout');

    t.mock.timers.tick(1);
    await flush();
    assert.deepEqual(prompt.decision, { behavior: 'deny', message: 'Permission request timed out' });
    const [cancelled] = cancellations(sent);
    assert.equal(cancelled?.reason, 'timeout');
    assert.equal(cancelled?.requestId, requestIdFor(sent, 'Bash'), 'the cancellation retracts the prompt that timed out');
    t.mock.timers.reset();
  });
});

test('a timeout set in Settings never cuts short a question Claude asks the user', async (t: TestContext) => {
  await withPromptRun({ permissionPromptTimeoutMs: 50 }, async ({ canUseTool, sent }) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const question = { questions: [{ question: 'Which file?', options: [] }] };
    const asked = track(canUseTool('AskUserQuestion', question, {}));
    const bash = track(canUseTool('Bash', BASH_INPUT, {}));
    await flush();

    t.mock.timers.tick(50);
    await flush();
    // The same run's tool prompt did time out, so the setting was in effect.
    assert.deepEqual(bash.decision, { behavior: 'deny', message: 'Permission request timed out' });

    t.mock.timers.tick(ONE_HOUR_MS);
    await flush();
    assert.equal(asked.decision, null, 'AskUserQuestion keeps waiting for the answer');
    assert.equal(cancellations(sent).length, 1, 'only the Bash prompt was retracted');

    const answered = { ...question, answers: { 'Which file?': 'a.txt' } };
    resolveToolApproval(requestIdFor(sent, 'AskUserQuestion'), { allow: true, updatedInput: answered });
    await flush();
    assert.deepEqual(asked.decision, { behavior: 'allow', updatedInput: answered });
    t.mock.timers.reset();
  });
});

test('a timeout beyond what a Node timer can hold is clamped instead of firing at once', async (t: TestContext) => {
  // Node's setTimeout overflows above 2^31 - 1 ms: it warns and fires after
  // 1 ms, which would deny every prompt immediately. Real timers here, since
  // the mocked ones do not reproduce the overflow.
  const timerDelays: unknown[] = [];
  const realSetTimeout = globalThis.setTimeout;
  t.mock.method(globalThis, 'setTimeout', ((callback: () => void, delay?: number) => {
    timerDelays.push(delay);
    return realSetTimeout(callback, delay);
  }) as typeof setTimeout);

  await withPromptRun({ permissionPromptTimeoutMs: 30 * 24 * ONE_HOUR_MS }, async ({ canUseTool, sent }) => {
    const prompt = track(canUseTool('Bash', BASH_INPUT, {}));
    await new Promise<void>((resolve) => { realSetTimeout(resolve, 50); });

    assert.ok(timerDelays.includes(2 ** 31 - 1), 'the prompt timer is armed at the longest delay Node supports');
    assert.equal(prompt.decision, null, 'the prompt is still waiting');
    assert.deepEqual(cancellations(sent), []);

    resolveToolApproval(requestIdFor(sent, 'Bash'), { allow: true });
    await flush();
    assert.deepEqual(prompt.decision, { behavior: 'allow', updatedInput: BASH_INPUT });
  });
});
