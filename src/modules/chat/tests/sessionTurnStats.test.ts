import assert from 'node:assert/strict';
import { test } from 'vitest';

import type { NormalizedMessage, TurnStats } from '@/shared/types';
import {
  deriveTurnMetrics,
  formatDuration,
  formatTokenCount,
  selectCurrentTurn,
} from '@/modules/chat/utils/sessionTurnStats';

const msg = (partial: Partial<NormalizedMessage> & { kind: NormalizedMessage['kind'] }): NormalizedMessage => ({
  id: Math.random().toString(36).slice(2),
  sessionId: 's1',
  timestamp: '2026-09-11T10:00:00.000Z',
  provider: 'claude',
  ...partial,
});

const frame = (overrides: Partial<TurnStats> = {}): TurnStats => ({
  costUsd: 0.042,
  durationMs: 181_000,
  apiDurationMs: 61_000,
  numTurns: 9,
  usage: { inputTokens: 18, outputTokens: 1900, cacheReadTokens: 40_460, cacheCreationTokens: 8_138 },
  ...overrides,
});

test('the turn is everything after the last main-thread user text', () => {
  const merged = [
    msg({ kind: 'text', role: 'user', content: 'first' }),
    msg({ kind: 'text', role: 'assistant', content: 'a1' }),
    msg({ kind: 'text', role: 'user', content: 'second' }),
    msg({ kind: 'tool_use', toolName: 'Bash', toolId: 't1' }),
    msg({ kind: 'tool_result', toolId: 't1' }),
  ];

  const turn = selectCurrentTurn(merged);
  assert.equal(turn.length, 2);
  assert.equal(turn[0].kind, 'tool_use');
});

test('a subagent user echo does not start a new turn', () => {
  const merged = [
    msg({ kind: 'text', role: 'user', content: 'ask' }),
    msg({ kind: 'text', role: 'user', content: 'sub prompt', parentToolUseId: 'toolu_1' }),
    msg({ kind: 'text', role: 'assistant', content: 'a1' }),
  ];

  assert.equal(selectCurrentTurn(merged).length, 2);
});

test('the frame drives speed, durations and cost', () => {
  const merged = [
    msg({ kind: 'text', role: 'user', content: 'go' }),
    msg({ kind: 'tool_use', toolName: 'Bash', toolId: 't1' }),
    msg({ kind: 'tool_use', toolName: 'Read', toolId: 't2' }),
  ];

  const metrics = deriveTurnMetrics(merged, frame(), { used: 49_000, cacheReadTokens: 40_460 });

  assert.equal(metrics.steps, 2);
  assert.equal(metrics.modelDurationMs, 61_000);
  assert.equal(metrics.toolDurationMs, 181_000 - 61_000);
  assert.equal(metrics.costUsd, 0.042);
  // 1900 output tokens over 61s of model time.
  assert.ok(metrics.answerSpeedTokPerSec !== null);
  assert.ok(Math.abs(metrics.answerSpeedTokPerSec - 1900 / 61) < 0.01);
  assert.equal(metrics.outputTokens, 1900);
  assert.equal(metrics.inputTokens, 49_000);
  assert.ok(metrics.cacheHitPercent !== null);
  assert.ok(Math.abs(metrics.cacheHitPercent - (40_460 / 49_000) * 100) < 0.01);
});

test('subagent tool calls are not main-thread steps', () => {
  const merged = [
    msg({ kind: 'text', role: 'user', content: 'go' }),
    msg({ kind: 'tool_use', toolName: 'Agent', toolId: 't1' }),
    msg({ kind: 'tool_use', toolName: 'Read', toolId: 't2', parentToolUseId: 't1' }),
  ];

  const metrics = deriveTurnMetrics(merged, frame(), null);
  assert.equal(metrics.steps, 1);
});

test('without the frame, metrics degrade instead of lying', () => {
  const merged = [msg({ kind: 'text', role: 'user', content: 'go' })];

  const metrics = deriveTurnMetrics(merged, null, null);

  assert.equal(metrics.costUsd, null);
  assert.equal(metrics.modelDurationMs, null);
  assert.equal(metrics.answerSpeedTokPerSec, null);
  assert.equal(metrics.requestSpeedTokPerSec, null);
});

test('tool duration pairs tool_use with tool_result timestamps', () => {
  const merged = [
    msg({ kind: 'text', role: 'user', content: 'go' }),
    msg({ kind: 'tool_use', toolName: 'Bash', toolId: 't1', timestamp: '2026-09-11T10:00:00.000Z' }),
    msg({ kind: 'tool_result', toolId: 't1', timestamp: '2026-09-11T10:00:03.500Z' }),
  ];

  // No frame durations -> pairing fallback must produce 3.5s.
  const metrics = deriveTurnMetrics(merged, frame({ durationMs: null, apiDurationMs: null }), null);
  assert.equal(metrics.toolDurationMs, 3500);
});

test('formatters render the reference screenshot style', () => {
  assert.equal(formatDuration(61_000), '1m1s');
  assert.equal(formatDuration(170_000), '2m50s');
  assert.equal(formatDuration(null), '—');
  assert.equal(formatTokenCount(55_700), '55.7K');
  assert.equal(formatTokenCount(null), '—');
});
