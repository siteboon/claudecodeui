import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ClaudeSessionsProvider } from '@/modules/providers/list/claude/claude-sessions.provider.js';
import { CLAUDE_PREDEFINED_MODELS } from '@/modules/providers/list/claude/claude-models.provider.js';
import {
  extractCumulativeTokenBudget,
  extractTokenBudget,
  queryClaudeSDK,
} from '@/modules/providers/list/claude/claude-runtime.provider.js';
import type { NormalizedMessage, ProviderRuntimeContext } from '@/shared/types.js';

test('assistant usage produces a cumulative budget', () => {
  const budget = extractTokenBudget({
    type: 'assistant',
    message: {
      usage: {
        input_tokens: 12,
        cache_read_input_tokens: 40_000,
        cache_creation_input_tokens: 2_000,
        output_tokens: 500,
      },
    },
  });

  assert.ok(budget);
  assert.equal(budget.inputTokens, 42_012);
  assert.equal(budget.outputTokens, 500);
  assert.equal(budget.used, 42_512);
});

test('system task events with tool-usage shaped usage emit no budget', () => {
  // task_progress/task_notification carry usage {total_tokens, tool_uses,
  // duration_ms}; reading Anthropic keys off it produced a used: 0 budget
  // that flashed "0" in the composer mid-generation.
  const budget = extractTokenBudget({
    type: 'system',
    subtype: 'task_progress',
    task_id: 't-1',
    usage: { total_tokens: 5_000, tool_uses: 3, duration_ms: 1_200 },
  });

  assert.equal(budget, null);
});

test('subagent messages emit no budget for the parent session', () => {
  // A subagent's usage is its own context window; surfacing it made the
  // session counter drop to the subagent's number and bounce back.
  const budget = extractTokenBudget({
    type: 'assistant',
    parent_tool_use_id: 'toolu_123',
    message: { usage: { input_tokens: 900, output_tokens: 10 } },
  });

  assert.equal(budget, null);
});

test('a turn-ending result emits no budget', () => {
  // `result.usage` is the turn's bill: every request it made, summed, each
  // subagent's included. A four-request turn therefore reports roughly four
  // times the context the conversation holds, so publishing it made the
  // counter leap when the turn ended and fall back on the next turn's first
  // assistant message.
  const budget = extractTokenBudget({
    type: 'result',
    usage: {
      input_tokens: 18,
      cache_creation_input_tokens: 8_138,
      cache_read_input_tokens: 40_460,
      output_tokens: 166,
    },
    modelUsage: {
      'claude-sonnet-5': { inputTokens: 929, outputTokens: 177 },
    },
  });

  assert.equal(budget, null);
});

test('the cumulative reader stays available for SDK builds with no assistant usage', () => {
  const fromUsage = extractCumulativeTokenBudget({
    type: 'result',
    usage: { input_tokens: 18, cache_read_input_tokens: 40_460, output_tokens: 166 },
  });

  assert.ok(fromUsage);
  assert.equal(fromUsage.used, 40_644);

  const fromModelUsage = extractCumulativeTokenBudget({
    type: 'result',
    modelUsage: {
      'claude-sonnet-5': { cumulativeInputTokens: 1_000, cumulativeOutputTokens: 200 },
    },
  });

  assert.ok(fromModelUsage);
  assert.equal(fromModelUsage.used, 1_200);
});

test('the cumulative reader ignores anything that is not a result', () => {
  assert.equal(
    extractCumulativeTokenBudget({
      type: 'assistant',
      message: { usage: { input_tokens: 10, output_tokens: 2 } },
    }),
    null,
  );
});

test('a per-call payload with no cache accounting emits no budget', () => {
  // Some stacks stream assistant frames carrying input_tokens and output_tokens
  // and nothing else. `input_tokens` is then only the *uncached* remainder — 2
  // against a warm cache — so reading it as the prompt put single digits in
  // the counter for the rest of the turn. Publishing nothing leaves the
  // reading to the transcript fallback in the stream loop.
  const budget = extractTokenBudget({
    type: 'assistant',
    message: { usage: { input_tokens: 2, output_tokens: 118 } },
  });

  assert.equal(budget, null);
});

test('one cache half without the other emits no budget', () => {
  // Half an account is still partial: the missing half defaults to zero in
  // the prompt total, so the reading would understate the context by whatever
  // that half held.
  const budget = extractTokenBudget({
    type: 'assistant',
    message: {
      usage: {
        input_tokens: 12,
        cache_read_input_tokens: 40_000,
        output_tokens: 500,
      },
    },
  });

  assert.equal(budget, null);
});

test('an all-zero account emits no budget', () => {
  // `<synthetic>` rows — the interrupt notice, an API error, the usage-limit
  // line — carry an all-zero usage block. Publishing one zeroed the counter
  // for the whole turn, because it also marked the turn as having published,
  // which suppressed the result fallback.
  const budget = extractTokenBudget({
    type: 'assistant',
    message: {
      usage: {
        input_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        output_tokens: 0,
      },
    },
  });

  assert.equal(budget, null);
});

test('zero cache values with a real prompt still count as a reading', () => {
  // A first request against a cold cache reports both cache halves as zero.
  // Presence is the test, not the value, or the opening turn of every session
  // would report nothing.
  const budget = extractTokenBudget({
    type: 'assistant',
    message: {
      usage: {
        input_tokens: 5_479,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        output_tokens: 12,
      },
    },
  });

  assert.ok(budget);
  assert.equal(budget.used, 5_491);
});

/* ------------------------------------------------------------------ */
/* Live stream loop: transcript fallback for unusable streamed usage  */
/* ------------------------------------------------------------------ */

/**
 * The scripted-stream seam from the runtime-hold tests, one-shot flavor: the
 * fake query yields a fixed frame list and ends, so `queryClaudeSDK` runs its
 * whole loop — including the token-budget publication block — without a CLI.
 */
const createOneShotQuery = (frames: Array<Record<string, unknown>>): NonNullable<ProviderRuntimeContext['createQuery']> =>
  () => {
    const iterator = (async function* () {
      for (const frame of frames) {
        yield frame as never;
      }
    })();
    return Object.assign(iterator, {
      interrupt: async () => {},
      stopTask: async () => {},
    });
  };

const assistantFrame = (usage: Record<string, number> | null, sessionId: string) => ({
  type: 'assistant',
  session_id: sessionId,
  parent_tool_use_id: null,
  message: {
    role: 'assistant',
    ...(usage ? { usage } : {}),
    content: [{ type: 'text', text: 'working' }],
  },
});

const resultFrame = (sessionId: string, usage: Record<string, number>) => ({
  type: 'result',
  session_id: sessionId,
  subtype: 'success',
  usage,
});

const budgetFrames = (sent: NormalizedMessage[]) => sent.filter(
  (message) => message.kind === 'status' && message.text === 'token_budget',
);

async function withPatchedHome(runTest: (homeDir: string) => Promise<void>): Promise<void> {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'claude-budget-home-'));
  const original = os.homedir;
  (os as never as { homedir: () => string }).homedir = () => homeDir;
  try {
    await runTest(homeDir);
  } finally {
    (os as never as { homedir: () => string }).homedir = original;
    await rm(homeDir, { recursive: true, force: true });
  }
}

async function driveRun(
  frames: Array<Record<string, unknown>>,
  cwd: string,
): Promise<NormalizedMessage[]> {
  const sent: NormalizedMessage[] = [];
  const writer = { send: (message: NormalizedMessage) => { sent.push(message); }, userId: null };
  const sessions = new ClaudeSessionsProvider({ getLiveRunStartTime: () => null });
  const context: ProviderRuntimeContext = {
    resolveProviderSessionId: () => null,
    resolveResumeModel: async () => undefined,
    getProviderModels: async () => CLAUDE_PREDEFINED_MODELS as never,
    normalizeMessage: (raw, sessionId) => sessions.normalizeMessage(raw, sessionId),
    isProviderInstalled: async () => true,
    createQuery: createOneShotQuery(frames),
  };

  await queryClaudeSDK('hello', { sessionId: `budget-app-${frames.length}-${Math.floor(Math.random() * 1e9)}`, cwd }, writer as never, context);
  return sent;
}

test('a live frame with unusable usage publishes the transcript reading instead', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'claude-budget-cwd-'));
  const nativeId = 'budget-native-1';

  try {
    await withPatchedHome(async (homeDir) => {
      // A prior response's complete account, already on disk mid-turn — the
      // position a warm-cache turn is in when its streamed frames arrive
      // zeroed or partial behind a gateway.
      const encoded = cwd.replace(/[^a-zA-Z0-9-]/g, '-');
      const projectDir = path.join(homeDir, '.claude', 'projects', encoded);
      await mkdir(projectDir, { recursive: true });
      await writeFile(path.join(projectDir, `${nativeId}.jsonl`), `${JSON.stringify({
        type: 'assistant',
        isSidechain: false,
        message: {
          role: 'assistant',
          usage: { input_tokens: 2_309, cache_creation_input_tokens: 0, cache_read_input_tokens: 88_832, output_tokens: 1_216 },
        },
      })}\n`, 'utf8');

      const sent = await driveRun([
        assistantFrame({ input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0 }, nativeId),
        resultFrame(nativeId, { input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0 }),
      ], cwd);

      const budgets = budgetFrames(sent);
      assert.equal(budgets.length, 1, 'exactly one reading, from the transcript');
      assert.equal((budgets[0].tokenBudget as Record<string, number> | undefined)?.used, 92_357);
      assert.equal((budgets[0].tokenBudget as Record<string, number> | undefined)?.inputTokens, 91_141);
    });
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('a complete streamed account publishes directly, transcript or not', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'claude-budget-cwd-'));
  const nativeId = 'budget-native-2';

  try {
    await withPatchedHome(async () => {
      const sent = await driveRun([
        assistantFrame({ input_tokens: 100, cache_creation_input_tokens: 50, cache_read_input_tokens: 20_000, output_tokens: 400 }, nativeId),
        resultFrame(nativeId, { input_tokens: 100, cache_read_input_tokens: 20_000, output_tokens: 400 }),
      ], cwd);

      const budgets = budgetFrames(sent);
      assert.equal(budgets.length, 1, 'the streamed account is the reading; the result adds nothing');
      assert.equal((budgets[0].tokenBudget as Record<string, number> | undefined)?.used, 20_550);
    });
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('with no streamed usage and no transcript, the result fallback still lands', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'claude-budget-cwd-'));
  const nativeId = 'budget-native-3';

  try {
    await withPatchedHome(async () => {
      const sent = await driveRun([
        assistantFrame(null, nativeId),
        resultFrame(nativeId, { input_tokens: 10, cache_read_input_tokens: 1_000, cache_creation_input_tokens: 20, output_tokens: 5 }),
      ], cwd);

      const budgets = budgetFrames(sent);
      assert.equal(budgets.length, 1, 'the zero-usage frame publishes nothing; only the result fallback does');
      assert.equal((budgets[0].tokenBudget as Record<string, number> | undefined)?.used, 1_035);
    });
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
