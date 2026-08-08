import assert from 'node:assert/strict';
import test from 'node:test';

import { extractTokenBudget } from '@/modules/providers/list/claude/claude-runtime.provider.js';

test('task-progress usage shapes do not produce a token budget', () => {
  const budget = extractTokenBudget({
    type: 'system',
    subtype: 'task_progress',
    usage: { total_tokens: 5000, tool_uses: 3, duration_ms: 1200 },
  });

  assert.equal(budget, null);
});

test('synthetic all-zero usage does not produce a token budget', () => {
  const budget = extractTokenBudget({
    type: 'assistant',
    message: { model: '<synthetic>', usage: { input_tokens: 0, output_tokens: 0 } },
  });

  assert.equal(budget, null);
});

test('real assistant usage produces a token budget including cache reads', () => {
  const budget = extractTokenBudget({
    type: 'assistant',
    message: { usage: { input_tokens: 1200, cache_read_input_tokens: 40000, output_tokens: 300 } },
  });

  assert.ok(budget);

  const { used, outputTokens, cacheReadTokens } = budget as Record<string, unknown>;
  assert.equal(used, 41500);
  assert.equal(outputTokens, 300);
  assert.equal(cacheReadTokens, 40000);
});

test('result usage yields the last iteration, not the run-aggregated total', () => {
  const budget = extractTokenBudget({
    type: 'result',
    subtype: 'success',
    usage: {
      input_tokens: 12,
      cache_creation_input_tokens: 16901,
      cache_read_input_tokens: 217126,
      output_tokens: 558,
      iterations: [
        { input_tokens: 2, output_tokens: 5, cache_read_input_tokens: 39264, cache_creation_input_tokens: 248 },
      ],
    },
  });

  assert.ok(budget);

  const { used } = budget as Record<string, unknown>;
  assert.equal(used, 39519);
  assert.notEqual(used, 234597);
});

test('a trailing compaction iteration is skipped for the last message iteration', () => {
  const budget = extractTokenBudget({
    type: 'result',
    subtype: 'success',
    usage: {
      input_tokens: 12,
      output_tokens: 558,
      iterations: [
        { type: 'message', input_tokens: 2, output_tokens: 5, cache_read_input_tokens: 39264, cache_creation_input_tokens: 248 },
        { type: 'compaction', input_tokens: 100, output_tokens: 200, cache_read_input_tokens: 900, cache_creation_input_tokens: 0 },
      ],
    },
  });

  assert.ok(budget);

  const { used } = budget as Record<string, unknown>;
  assert.equal(used, 39519);
});

test('result usage without iterations does not produce a token budget', () => {
  const budget = extractTokenBudget({
    type: 'result',
    subtype: 'success',
    usage: {
      input_tokens: 12,
      cache_creation_input_tokens: 16901,
      cache_read_input_tokens: 217126,
      output_tokens: 558,
    },
  });

  assert.equal(budget, null);
});
