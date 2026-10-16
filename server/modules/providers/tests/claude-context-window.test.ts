import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ClaudeSessionsProvider } from '@/modules/providers/list/claude/claude-sessions.provider.js';
import { CLAUDE_PREDEFINED_MODELS } from '@/modules/providers/list/claude/claude-models.provider.js';
import { queryClaudeSDK } from '@/modules/providers/list/claude/claude-runtime.provider.js';
import { createProviderTokenUsageService } from '@/modules/providers/services/provider-token-usage.service.js';
import type { NormalizedMessage, ProviderRuntimeContext } from '@/shared/types.js';

/**
 * The context-window total comes from the window the SDK reports for the model
 * that served the turn (`result.modelUsage[model].contextWindow`), not from the
 * server-wide CONTEXT_WINDOW setting, which cannot know which model — or which
 * 200K/1M variant of it — a session runs. CONTEXT_WINDOW stays the fallback for
 * runs that report no window.
 */

type Emitted = Record<string, unknown>;

/** Drives `queryClaudeSDK` through one scripted SDK stream and returns every message it sent. */
async function runScripted(
  appSessionId: string,
  stream: Emitted[],
  resumeProviderSessionId: string | null = null,
): Promise<NormalizedMessage[]> {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'claude-context-window-'));
  const sent: NormalizedMessage[] = [];
  const writer = { send: (message: NormalizedMessage) => { sent.push(message); }, userId: null };
  const sessions = new ClaudeSessionsProvider({ getLiveRunStartTime: () => null });
  const context: ProviderRuntimeContext = {
    resolveProviderSessionId: () => resumeProviderSessionId,
    resolveResumeModel: async () => undefined,
    getProviderModels: async () => CLAUDE_PREDEFINED_MODELS as never,
    normalizeMessage: (raw, sessionId) => sessions.normalizeMessage(raw, sessionId),
    isProviderInstalled: async () => true,
    createQuery: ({ prompt }) => {
      // Drain the held prompt like the CLI would read its stdin.
      void (async () => { for await (const _message of prompt) { /* read */ } })();
      const iterator = (async function* () { yield* stream; })();
      return Object.assign(iterator, { interrupt: async () => {} }) as never;
    },
  };

  try {
    await queryClaudeSDK('hello', { sessionId: appSessionId, cwd }, writer as never, context);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
  return sent;
}

const tokenBudgets = (sent: NormalizedMessage[]) =>
  sent
    .filter((message) => message.kind === 'status' && message.text === 'token_budget')
    .map((message) => message.tokenBudget as { used: number; total: number });

const usage = { input_tokens: 12, cache_read_input_tokens: 40_000, cache_creation_input_tokens: 2_000, output_tokens: 500 };

const assistant = (nativeId: string, model: string, extra: Emitted = {}) => ({
  type: 'assistant',
  session_id: nativeId,
  parent_tool_use_id: null,
  message: { role: 'assistant', model, content: [{ type: 'text', text: 'ok' }], usage },
  ...extra,
});

const result = (nativeId: string, modelUsage: Record<string, Emitted> | undefined) => ({
  type: 'result',
  subtype: 'success',
  session_id: nativeId,
  result: 'ok',
  duration_ms: 1,
  num_turns: 1,
  usage,
  ...(modelUsage ? { modelUsage } : {}),
});

const modelUsageEntry = (contextWindow: number | undefined, canonicalModel?: string) => ({
  inputTokens: 12,
  outputTokens: 500,
  cacheReadInputTokens: 40_000,
  cacheCreationInputTokens: 2_000,
  webSearchRequests: 0,
  costUSD: 0,
  ...(contextWindow === undefined ? {} : { contextWindow }),
  maxOutputTokens: 64_000,
  ...(canonicalModel ? { canonicalModel } : {}),
});

/** Runs a test body with CONTEXT_WINDOW set (or unset) and restores it afterwards. */
async function withContextWindowEnv(value: string | undefined, body: () => Promise<void>): Promise<void> {
  const previous = process.env.CONTEXT_WINDOW;
  if (value === undefined) {
    delete process.env.CONTEXT_WINDOW;
  } else {
    process.env.CONTEXT_WINDOW = value;
  }
  try {
    await body();
  } finally {
    if (previous === undefined) {
      delete process.env.CONTEXT_WINDOW;
    } else {
      process.env.CONTEXT_WINDOW = previous;
    }
  }
}

test('the live budget reports the window the SDK measured for a [1m] model', async () => {
  await withContextWindowEnv(undefined, async () => {
    const nativeId = 'native-1m';
    const sent = await runScripted('app-1m', [
      { type: 'system', subtype: 'init', session_id: nativeId },
      assistant(nativeId, 'claude-sonnet-5-5'),
      // Captured from the real CLI (2.1.295): the key carries the [1m] suffix
      // the assistant row's `message.model` lacks.
      result(nativeId, { 'claude-sonnet-5-5[1m]': modelUsageEntry(1_000_000, 'claude-sonnet-5-5') }),
    ]);

    const budgets = tokenBudgets(sent);
    assert.ok(budgets.length > 0);
    const last = budgets.at(-1)!;
    assert.equal(last.total, 1_000_000);
    // The reading itself is still the last request's prompt, not the turn's bill.
    assert.equal(last.used, 42_512);
  });
});

test('a reported window wins over an explicit CONTEXT_WINDOW', async () => {
  await withContextWindowEnv('160000', async () => {
    const nativeId = 'native-haiku';
    const sent = await runScripted('app-haiku', [
      { type: 'system', subtype: 'init', session_id: nativeId },
      assistant(nativeId, 'claude-haiku-4-5-20251001'),
      result(nativeId, { 'claude-haiku-4-5-20251001': modelUsageEntry(200_000) }),
    ]);

    assert.equal(tokenBudgets(sent).at(-1)!.total, 200_000);
  });
});

test('the main model\'s window is used, not a subagent model\'s', async () => {
  await withContextWindowEnv(undefined, async () => {
    const nativeId = 'native-subagent';
    const sent = await runScripted('app-subagent', [
      { type: 'system', subtype: 'init', session_id: nativeId },
      assistant(nativeId, 'claude-haiku-4-5', { parent_tool_use_id: 'toolu_agent' }),
      assistant(nativeId, 'claude-opus-4-6'),
      result(nativeId, {
        'claude-haiku-4-5': modelUsageEntry(200_000),
        'claude-opus-4-6[1m]': modelUsageEntry(1_000_000),
      }),
    ]);

    assert.equal(tokenBudgets(sent).at(-1)!.total, 1_000_000);
  });
});

test('CONTEXT_WINDOW stays the fallback when the SDK reports no window', async () => {
  await withContextWindowEnv('123456', async () => {
    const nativeId = 'native-no-window';
    const sent = await runScripted('app-no-window', [
      { type: 'system', subtype: 'init', session_id: nativeId },
      assistant(nativeId, 'claude-local'),
      result(nativeId, { 'claude-local': modelUsageEntry(undefined) }),
    ]);

    const budgets = tokenBudgets(sent);
    assert.ok(budgets.length > 0);
    assert.ok(budgets.every((budget) => budget.total === 123_456));
  });
});

test('the history-derived usage keeps the window the run reported', async () => {
  await withContextWindowEnv(undefined, async () => {
    const nativeId = 'native-history';
    await runScripted('app-history', [
      { type: 'system', subtype: 'init', session_id: nativeId },
      assistant(nativeId, 'claude-local'),
      // A self-hosted model behind ANTHROPIC_BASE_URL with CLAUDE_CODE_MAX_CONTEXT_TOKENS.
      result(nativeId, { 'claude-local': modelUsageEntry(262_144) }),
    ]);

    const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'claude-context-window-history-'));
    const transcriptPath = path.join(tempDirectory, `${nativeId}.jsonl`);
    try {
      await writeFile(transcriptPath, `${JSON.stringify({ type: 'assistant', message: { model: 'claude-local', usage } })}\n`);
      const service = createProviderTokenUsageService({
        getSessionById: () => ({
          session_id: 'app-history',
          provider: 'claude',
          provider_session_id: nativeId,
          jsonl_path: transcriptPath,
        }) as never,
        isProviderSessionSuperseded: () => false,
      });

      const reloaded = await service.getSessionTokenUsage('app-history');
      assert.equal(reloaded.total, 262_144);
      assert.equal(reloaded.used, 42_512);

      // A session no run has reported on still falls back to the setting.
      const otherService = createProviderTokenUsageService({
        getSessionById: () => ({
          session_id: 'app-other',
          provider: 'claude',
          provider_session_id: 'native-never-ran',
          jsonl_path: transcriptPath,
        }) as never,
        isProviderSessionSuperseded: () => false,
      });
      assert.equal((await otherService.getSessionTokenUsage('app-other')).total, 160_000);
    } finally {
      await rm(tempDirectory, { recursive: true, force: true });
    }
  });
});

test('a resumed session measures its first reading against the window it last reported', async () => {
  await withContextWindowEnv('160000', async () => {
    const nativeId = 'native-resumed';
    await runScripted('app-resumed', [
      { type: 'system', subtype: 'init', session_id: nativeId },
      assistant(nativeId, 'claude-opus-4-6'),
      result(nativeId, { 'claude-opus-4-6[1m]': modelUsageEntry(1_000_000, 'claude-opus-4-6') }),
    ]);

    const resumed = await runScripted('app-resumed', [
      { type: 'system', subtype: 'init', session_id: nativeId },
      assistant(nativeId, 'claude-opus-4-6'),
      result(nativeId, { 'claude-opus-4-6[1m]': modelUsageEntry(1_000_000, 'claude-opus-4-6') }),
    ], nativeId);

    const budgets = tokenBudgets(resumed);
    // No 160000 flash before the turn ends, and nothing re-sent when the window did not change.
    assert.deepEqual(budgets.map((budget) => budget.total), [1_000_000]);
  });
});
