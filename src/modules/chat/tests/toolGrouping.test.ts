import assert from 'node:assert/strict';

import { test } from 'vitest';

import { groupConsecutiveTools, isToolGroupItem } from '@/modules/chat/utils/toolGrouping';
import type { ChatMessage } from '@/shared/types';

/**
 * The collapsed group's summary line is built here rather than in
 * ToolGroupContainer because producing it JSON.parses tool inputs, which can be
 * whole file contents. The component's useMemo could never cache it — grouping
 * allocates a fresh messages array on every pass — so it ran on every render of
 * the transcript, including ten times a second while streaming.
 */

const toolMessage = (toolName: string, toolInput: unknown): ChatMessage => ({
  type: 'tool',
  content: '',
  timestamp: '2024-01-01T00:00:00.000Z',
  isToolUse: true,
  toolName,
  toolInput: typeof toolInput === 'string' ? toolInput : JSON.stringify(toolInput),
});

const textMessage = (content: string): ChatMessage => ({
  type: 'assistant',
  content,
  timestamp: '2024-01-01T00:00:00.000Z',
});

test('a run of same-tool calls is grouped and carries a precomputed preview', () => {
  const items = groupConsecutiveTools([
    toolMessage('Read', { file_path: '/a.ts' }),
    toolMessage('Read', { file_path: '/b.ts' }),
  ]);

  assert.equal(items.length, 1);
  const [group] = items;
  assert.ok(isToolGroupItem(group));
  assert.equal(typeof group.preview, 'string');
  assert.ok(group.preview.length > 0, 'a grouped run must have a summary line');
});

test('a group of more than two calls reports the remainder', () => {
  const items = groupConsecutiveTools([
    toolMessage('Read', { file_path: '/a.ts' }),
    toolMessage('Read', { file_path: '/b.ts' }),
    toolMessage('Read', { file_path: '/c.ts' }),
    toolMessage('Read', { file_path: '/d.ts' }),
  ]);

  const [group] = items;
  assert.ok(isToolGroupItem(group));
  assert.match(group.preview, /\+2 more$/);
});

test('a single tool call is not grouped', () => {
  const items = groupConsecutiveTools([toolMessage('Read', { file_path: '/a.ts' })]);

  assert.equal(items.length, 1);
  assert.equal(isToolGroupItem(items[0]), false);
});

test('different tools are not grouped together', () => {
  const items = groupConsecutiveTools([
    toolMessage('Read', { file_path: '/a.ts' }),
    toolMessage('Write', { file_path: '/b.ts' }),
  ]);

  assert.equal(items.length, 2);
  assert.equal(items.every((item) => !isToolGroupItem(item)), true);
});

test('a text turn splits a run', () => {
  const items = groupConsecutiveTools([
    toolMessage('Read', { file_path: '/a.ts' }),
    textMessage('some prose'),
    toolMessage('Read', { file_path: '/b.ts' }),
  ]);

  assert.equal(items.length, 3);
  assert.equal(items.filter(isToolGroupItem).length, 0);
});

test('an unparsable tool input does not throw while grouping', () => {
  const items = groupConsecutiveTools([
    toolMessage('Read', '{not json'),
    toolMessage('Read', '{also not json'),
  ]);

  const [group] = items;
  assert.ok(isToolGroupItem(group));
  assert.equal(typeof group.preview, 'string');
});

test('grouping the same messages twice yields the same preview', () => {
  const messages = [
    toolMessage('Read', { file_path: '/a.ts' }),
    toolMessage('Read', { file_path: '/b.ts' }),
  ];

  const [first] = groupConsecutiveTools(messages);
  const [second] = groupConsecutiveTools(messages);

  assert.ok(isToolGroupItem(first) && isToolGroupItem(second));
  assert.equal(first.preview, second.preview);
});
