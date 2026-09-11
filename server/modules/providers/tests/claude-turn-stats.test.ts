import assert from 'node:assert/strict';
import test from 'node:test';

import { extractTurnStats } from '@/modules/providers/list/claude/claude-runtime.provider.js';

test('a turn-ending result yields the turn bill', () => {
  const stats = extractTurnStats({
    type: 'result',
    subtype: 'success',
    duration_ms: 181_000,
    duration_api_ms: 61_000,
    num_turns: 9,
    total_cost_usd: 0.042,
    usage: {
      input_tokens: 18,
      cache_creation_input_tokens: 8_138,
      cache_read_input_tokens: 40_460,
      output_tokens: 166,
    },
  });

  assert.ok(stats);
  assert.equal(stats.costUsd, 0.042);
  assert.equal(stats.durationMs, 181_000);
  assert.equal(stats.apiDurationMs, 61_000);
  assert.equal(stats.numTurns, 9);
  assert.deepEqual(stats.usage, {
    inputTokens: 18,
    outputTokens: 166,
    cacheReadTokens: 40_460,
    cacheCreationTokens: 8_138,
  });
});

test('missing numbers stay null instead of zero', () => {
  // The panel renders "—" for absent metrics; coercing to 0 would claim a
  // free turn and a zero-length run.
  const stats = extractTurnStats({ type: 'result' });

  assert.ok(stats);
  assert.equal(stats.costUsd, null);
  assert.equal(stats.durationMs, null);
  assert.equal(stats.apiDurationMs, null);
  assert.equal(stats.numTurns, null);
  assert.equal(stats.usage, null);
});

test('a partial usage object keeps the reported fields', () => {
  const stats = extractTurnStats({
    type: 'result',
    usage: { output_tokens: 320 },
  });

  assert.ok(stats);
  assert.deepEqual(stats.usage, {
    inputTokens: null,
    outputTokens: 320,
    cacheReadTokens: null,
    cacheCreationTokens: null,
  });
});

test('anything that is not a result emits no stats', () => {
  assert.equal(extractTurnStats(null), null);
  assert.equal(extractTurnStats({ type: 'assistant', usage: { output_tokens: 1 } }), null);
  assert.equal(extractTurnStats({ type: 'system', subtype: 'task_progress' }), null);
});
