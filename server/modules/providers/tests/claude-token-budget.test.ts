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

test('a per-call payload with no cache accounting emits no budget', () => {
  // Some stacks stream assistant frames carrying input_tokens and output_tokens
  // and nothing else. `input_tokens` is then only the *uncached* remainder — 2
  // against a warm cache — so reading it as the prompt put single digits in the
  // badge for the rest of the session. Publishing nothing keeps the last
  // complete reading, which the transcript refresh also supplies.
  const budget = extractTokenBudget({
    type: 'assistant',
    message: { usage: { input_tokens: 2, output_tokens: 118 } },
  });

  assert.equal(budget, null);
});

test('zero cache fields still count as an account', () => {
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
  assert.equal(budget.inputTokens, 5_479);
  assert.equal(budget.used, 5_491);
});

test('an all-zero account emits no budget', () => {
  // The CLI writes its own messages into the stream as model `<synthetic>` —
  // the interrupt notice, an API error, the usage-limit line — with usage that
  // is zero throughout. Reading one as a budget dropped the badge to 0 until
  // the next real turn.
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
