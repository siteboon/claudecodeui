import assert from 'node:assert/strict';
import test from 'node:test';

import {
  extractCumulativeTokenBudget,
  extractTokenBudget,
} from '@/modules/providers/list/claude/claude-runtime.provider.js';

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

/**
 * The window the bar divides by used to come from one global env var, shared by
 * every session whatever model it ran. Set for a 1M model it overstates a 200k
 * one five times over, so a session close to auto-compact reads as a quarter
 * full. The SDK reports the real window per model on every `result`.
 */

test('a result frame yields the window the SDK reported, not the env default', () => {
  const budget = extractCumulativeTokenBudget({
    type: 'result',
    usage: { input_tokens: 1000, output_tokens: 500 },
    modelUsage: {
      'claude-opus-5': { inputTokens: 1000, outputTokens: 500, contextWindow: 200000 },
    },
  });

  assert.equal(budget?.total, 200000);
  assert.equal(budget?.used, 1500);
});

test('the conversation model wins when a subagent ran on another one', () => {
  const budget = extractCumulativeTokenBudget({
    type: 'result',
    usage: { input_tokens: 90000, output_tokens: 1000 },
    modelUsage: {
      // The subagent barely used anything; its window must not become the bar's.
      'claude-haiku-4-5': { inputTokens: 200, outputTokens: 50, contextWindow: 200000 },
      'claude-opus-5-1m': { inputTokens: 90000, outputTokens: 1000, contextWindow: 1000000 },
    },
  });

  assert.equal(budget?.total, 1000000);
});

test('a frame without a reported window still produces a budget', () => {
  const budget = extractCumulativeTokenBudget({
    type: 'result',
    usage: { input_tokens: 10, output_tokens: 5 },
    modelUsage: { 'claude-opus-5': { inputTokens: 10, outputTokens: 5 } },
  });

  assert.ok(budget);
  assert.ok((budget?.total ?? 0) > 0, 'falls back rather than dividing by zero');
});

test('an assistant budget uses the window last reported for the session', () => {
  const assistantMessage = {
    type: 'assistant',
    message: { usage: { input_tokens: 400, output_tokens: 100 } },
  };

  assert.equal(extractTokenBudget(assistantMessage, 1000000)?.total, 1000000);
  assert.equal(extractTokenBudget(assistantMessage, 200000)?.total, 200000);
  // Nothing known yet — the first turn of a session falls back until its result.
  assert.ok((extractTokenBudget(assistantMessage)?.total ?? 0) > 0);
});

test('a nonsensical reported window is ignored rather than trusted', () => {
  const assistantMessage = {
    type: 'assistant',
    message: { usage: { input_tokens: 400, output_tokens: 100 } },
  };

  for (const bad of [0, -1, Number.NaN]) {
    const budget = extractTokenBudget(assistantMessage, bad);
    assert.ok((budget?.total ?? 0) > 0, `window ${bad} should fall back`);
  }
});
