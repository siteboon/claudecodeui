import assert from 'node:assert/strict';

import { test } from 'vitest';

import { computeTurnDurations, formatTurnDuration } from '@/modules/chat/utils/turnDurations';
import type { ChatMessage } from '@/shared/types';

const at = (seconds: number) => new Date(Date.UTC(2026, 8, 18, 12, 0, seconds)).toISOString();

const user = (seconds: number): ChatMessage => ({
  type: 'user',
  content: 'go',
  timestamp: at(seconds),
});

const assistant = (seconds: number, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  type: 'assistant',
  content: 'sure',
  timestamp: at(seconds),
  ...extra,
});

const tool = (seconds: number): ChatMessage => ({
  type: 'assistant',
  content: '',
  timestamp: at(seconds),
  isToolUse: true,
  toolName: 'Bash',
});

test('times a turn from its prompt to its last row', () => {
  const prompt = user(0);
  const reply = assistant(4);
  const durations = computeTurnDurations([prompt, reply, user(30), assistant(31)]);

  assert.equal(durations.get(reply), 4_000);
});

test('prefers the duration the run recorded over the gap between rows', () => {
  // The recorded number counts the stretch after the last message, which the
  // timestamps cannot see: a turn that ends on a tool call keeps running long
  // after its final row was written.
  const reply = assistant(4);
  const durations = computeTurnDurations([
    user(0),
    reply,
    { ...tool(5), durationMs: 41_000 },
    user(60),
  ]);

  assert.equal(durations.get(reply), 41_000);
});

test('hangs the duration on the reply, not on a tool row', () => {
  const firstTool = tool(1);
  const reply = assistant(6);
  const durations = computeTurnDurations([user(0), firstTool, reply, user(30)]);

  assert.equal(durations.has(firstTool), false);
  assert.equal(durations.get(reply), 6_000);
});

test('leaves a turn still running untimed', () => {
  const reply = assistant(4);
  const durations = computeTurnDurations([user(0), reply], true);

  assert.equal(durations.size, 0);
});

test('skips a page of history that begins mid-turn', () => {
  // Pagination can drop the prompt off the top; with nothing to measure from,
  // no number is better than one measured from the top of the page.
  const reply = assistant(4);
  const durations = computeTurnDurations([reply, tool(5)]);

  assert.equal(durations.size, 0);
});

test('formats at the precision the number deserves', () => {
  assert.equal(formatTurnDuration(1_141), '1.1s');
  assert.equal(formatTurnDuration(42_000), '42s');
  assert.equal(formatTurnDuration(200_000), '3m 20s');
  assert.equal(formatTurnDuration(3_900_000), '1h 05m');
  assert.equal(formatTurnDuration(0), '');
});
