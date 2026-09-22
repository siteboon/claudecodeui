import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ClaudeSessionsProvider } from '@/modules/providers/list/claude/claude-sessions.provider.js';
import { CLAUDE_PREDEFINED_MODELS } from '@/modules/providers/list/claude/claude-models.provider.js';
import {
  queryClaudeSDK,
  resolveToolApproval,
  resolveToolApprovalTimeoutMs,
} from '@/modules/providers/list/claude/claude-runtime.provider.js';
import type { NormalizedMessage, ProviderRuntimeContext } from '@/shared/types.js';

/**
 * A permission prompt that nobody answers is denied after
 * CLAUDE_TOOL_APPROVAL_TIMEOUT_MS (issue #607). These pin the env-var mapping —
 * an explicit 0 used to fall back to the default because of `|| 55000` — and
 * drive the real `canUseTool` callback through the `context.createQuery` seam
 * to show the value is honoured end to end: a short timeout cancels the prompt
 * and denies the tool, 0 keeps the prompt open until a late answer arrives.
 */

const DEFAULT_TIMEOUT_MS = 55000;
/** Node's setTimeout ceiling (2^31 - 1 ms); larger delays overflow and fire after 1 ms. */
const MAX_TIMER_MS = 2147483647;

test('resolveToolApprovalTimeoutMs maps the env value onto a wait duration', () => {
  assert.equal(resolveToolApprovalTimeoutMs(undefined), DEFAULT_TIMEOUT_MS, 'unset keeps the historical default');
  assert.equal(resolveToolApprovalTimeoutMs(''), DEFAULT_TIMEOUT_MS, 'an empty .env line counts as unset');
  assert.equal(resolveToolApprovalTimeoutMs('abc'), DEFAULT_TIMEOUT_MS, 'garbage falls back to the default');
  assert.equal(resolveToolApprovalTimeoutMs('0'), 0, '0 disables the timeout instead of becoming the default');
  assert.equal(resolveToolApprovalTimeoutMs('00'), 0, 'a zero with leading zeros is still zero');
  assert.equal(resolveToolApprovalTimeoutMs('-1'), 0, 'negative values disable the timeout too');
  assert.equal(resolveToolApprovalTimeoutMs('120000'), 120000, 'a positive value is used as-is');
  assert.equal(resolveToolApprovalTimeoutMs('+5000'), 5000, 'an explicit plus sign is accepted');
  assert.equal(resolveToolApprovalTimeoutMs(' 5000 '), 5000, 'surrounding whitespace is tolerated');
});

test('resolveToolApprovalTimeoutMs clamps values beyond the setTimeout ceiling instead of overflowing', () => {
  assert.equal(resolveToolApprovalTimeoutMs(String(MAX_TIMER_MS)), MAX_TIMER_MS, 'the ceiling itself is accepted');
  assert.equal(resolveToolApprovalTimeoutMs('2592000000'), MAX_TIMER_MS, '30 days is clamped rather than firing after 1ms');
  assert.equal(resolveToolApprovalTimeoutMs('31536000000'), MAX_TIMER_MS, 'a year is clamped rather than firing after 1ms');
  assert.equal(resolveToolApprovalTimeoutMs('99999999999999999999'), MAX_TIMER_MS, 'values beyond Number precision still clamp');
});

test('resolveToolApprovalTimeoutMs rejects notations parseInt would silently truncate', () => {
  assert.equal(resolveToolApprovalTimeoutMs('1e6'), DEFAULT_TIMEOUT_MS, 'exponent notation would become 1ms under parseInt');
  assert.equal(resolveToolApprovalTimeoutMs('1.5'), DEFAULT_TIMEOUT_MS, 'decimals would become 1ms under parseInt');
  assert.equal(resolveToolApprovalTimeoutMs('0x10'), DEFAULT_TIMEOUT_MS, 'hex would become 0 (wait forever) under parseInt');
  assert.equal(resolveToolApprovalTimeoutMs('55000ms'), DEFAULT_TIMEOUT_MS, 'a unit suffix is not a plain integer');
  assert.equal(resolveToolApprovalTimeoutMs('Infinity'), DEFAULT_TIMEOUT_MS, 'Infinity is not a plain integer');
});

type CanUseTool = (toolName: string, input: Record<string, unknown>, context: Record<string, unknown>) => Promise<Record<string, unknown>>;

/** Captures the `canUseTool` the runtime hands the SDK, and never yields a message so the run stays open. */
function createCapturingQuery(): { createQuery: NonNullable<ProviderRuntimeContext['createQuery']>; canUseTool: Promise<CanUseTool>; end: () => void } {
  let capture: ((canUseTool: CanUseTool) => void) | null = null;
  // Resolves once the runtime has finished its async setup and built the SDK options.
  const canUseTool = new Promise<CanUseTool>((resolve) => { capture = resolve; });
  let finish: (() => void) | null = null;
  const ended = new Promise<void>((resolve) => { finish = resolve; });

  const createQuery: NonNullable<ProviderRuntimeContext['createQuery']> = ({ prompt, options }) => {
    capture?.(options.canUseTool as CanUseTool);
    void (async () => { for await (const _message of prompt) { /* drain stdin like the CLI would */ } })();
    // Yields nothing: the run only has to stay open while the prompt is answered.
    const iterator: AsyncIterableIterator<unknown> = {
      [Symbol.asyncIterator]() { return this; },
      async next() { await ended; return { done: true, value: undefined }; },
    };
    return Object.assign(iterator, { interrupt: async () => {} });
  };

  return { createQuery, canUseTool, end: () => finish?.() };
}

async function withPermissionPrompt(
  timeoutEnv: string | undefined,
  runTest: (context: { canUseTool: CanUseTool; sent: NormalizedMessage[] }) => Promise<void>,
): Promise<void> {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'claude-permission-timeout-'));
  const previous = process.env.CLAUDE_TOOL_APPROVAL_TIMEOUT_MS;
  if (timeoutEnv === undefined) {
    delete process.env.CLAUDE_TOOL_APPROVAL_TIMEOUT_MS;
  } else {
    process.env.CLAUDE_TOOL_APPROVAL_TIMEOUT_MS = timeoutEnv;
  }

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

  try {
    const done = queryClaudeSDK('touch a file', { sessionId: `permission-timeout-${timeoutEnv ?? 'default'}`, cwd }, writer as never, context);
    await runTest({ canUseTool: await canUseTool, sent });
    end();
    await done;
  } finally {
    if (previous === undefined) {
      delete process.env.CLAUDE_TOOL_APPROVAL_TIMEOUT_MS;
    } else {
      process.env.CLAUDE_TOOL_APPROVAL_TIMEOUT_MS = previous;
    }
    await rm(cwd, { recursive: true, force: true });
  }
}

const requestIdOf = (sent: NormalizedMessage[]): string => {
  const request = sent.find((message) => message.kind === 'permission_request') as (NormalizedMessage & { requestId?: string }) | undefined;
  assert.ok(request?.requestId, 'the prompt reached the client');
  return request.requestId;
};

test('a positive CLAUDE_TOOL_APPROVAL_TIMEOUT_MS cancels an unanswered prompt and denies the tool', async () => {
  await withPermissionPrompt('120', async ({ canUseTool, sent }) => {
    const startedAt = Date.now();
    const decision = await canUseTool('Bash', { command: 'touch scratch.txt' }, {});
    const elapsed = Date.now() - startedAt;

    assert.deepEqual(decision, { behavior: 'deny', message: 'Permission request timed out' });
    assert.ok(elapsed >= 100 && elapsed < 5000, `denied after the configured 120ms, not the 55s default (took ${elapsed}ms)`);
    const cancelled = sent.find((message) => message.kind === 'permission_cancelled') as (NormalizedMessage & { reason?: string; requestId?: string }) | undefined;
    assert.equal(cancelled?.reason, 'timeout');
    assert.equal(cancelled?.requestId, requestIdOf(sent), 'the cancellation retracts the prompt it timed out');
  });
});

test('CLAUDE_TOOL_APPROVAL_TIMEOUT_MS=0 keeps the prompt open until the user answers', async () => {
  await withPermissionPrompt('0', async ({ canUseTool, sent }) => {
    let decision: Record<string, unknown> | null = null;
    const pending = canUseTool('Bash', { command: 'touch scratch.txt' }, {}).then((result) => { decision = result; });

    // Well past the 120ms the previous test used; nothing may have fired.
    await new Promise((resolve) => { setTimeout(resolve, 400); });
    assert.equal(decision, null, 'the prompt is still waiting');
    assert.equal(sent.some((message) => message.kind === 'permission_cancelled'), false, 'no timeout cancellation was sent');

    // A late answer still lands: the tool runs and the prompt is retracted everywhere.
    resolveToolApproval(requestIdOf(sent), { allow: true });
    await pending;
    assert.deepEqual(decision, { behavior: 'allow', updatedInput: { command: 'touch scratch.txt' } });
    assert.ok(sent.some((message) => message.kind === 'permission_resolved'), 'the answer is announced on the run stream');
  });
});
