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

test('the modelUsage fallback sums every model the turn billed', () => {
  // A turn that ran a subagent on another model reports one entry per model.
  // Reading only the first key under-counted the turn and depended on key order.
  const budget = extractCumulativeTokenBudget({
    type: 'result',
    modelUsage: {
      'claude-haiku-5': { inputTokens: 300, outputTokens: 40, cacheReadInputTokens: 1_000, cacheCreationInputTokens: 0 },
      'claude-sonnet-5': { inputTokens: 900, outputTokens: 160, cacheReadInputTokens: 20_000, cacheCreationInputTokens: 2_000 },
    },
  });

  assert.ok(budget);
  assert.equal(budget.inputTokens, 300 + 1_000 + 900 + 20_000 + 2_000);
  assert.equal(budget.outputTokens, 40 + 160);
  assert.equal(budget.cacheReadTokens, 21_000);
  assert.equal(budget.cacheCreationTokens, 2_000);
  assert.equal(budget.used, 24_400);
});

test('the modelUsage fallback skips malformed entries and returns null when none is usable', () => {
  const budget = extractCumulativeTokenBudget({
    type: 'result',
    modelUsage: { broken: null, 'claude-sonnet-5': { inputTokens: 10, outputTokens: 5 } },
  });
  assert.ok(budget);
  assert.equal(budget.used, 15);

  assert.equal(extractCumulativeTokenBudget({ type: 'result', modelUsage: { broken: null } }), null);
  assert.equal(extractCumulativeTokenBudget({ type: 'result', modelUsage: {} }), null);
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
