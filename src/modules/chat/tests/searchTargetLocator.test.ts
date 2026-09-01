import assert from 'node:assert/strict';

import { test } from 'vitest';

import {
  findSearchTargetIndex,
  resolveSearchWindowSize,
} from '@/modules/chat/utils/searchTargetLocator';
import type { ChatMessage } from '@/shared/types';

/**
 * The sidebar search jump used to render the whole transcript and then scan the
 * DOM for the snippet. With nothing to identify the hit ahead of time, a miss
 * was indistinguishable from a hit: it scrolled somewhere plausible and flashed
 * the highlight, telling the user they had been taken to their result when they
 * had not.
 *
 * Resolving the index from the message data first is what makes a miss
 * detectable — findSearchTargetIndex returns -1 and the jump declines rather
 * than pretending. The DOM step still ends in a nearest-timestamp match on its
 * final retry (useChatSessionState's findRenderedMessageElement with
 * allowNearest), but only for a target it has already resolved: a hit collapsed
 * inside a tool group is rendered under the group's own first timestamp.
 */

const message = (content: string, timestamp: string): ChatMessage => ({
  type: 'assistant',
  content,
  timestamp,
});

const transcript: ChatMessage[] = [
  message('the very first thing we discussed was database indexing', '2024-01-01T10:00:00.000Z'),
  message('then we moved on to caching strategies', '2024-01-01T10:05:00.000Z'),
  message('finally we talked about deployment pipelines', '2024-01-01T10:10:00.000Z'),
];

test('a snippet matches the message that contains it', () => {
  const index = findSearchTargetIndex(transcript, { snippet: 'caching strategies' });
  assert.equal(index, 1);
});

test('snippet matching ignores case', () => {
  const index = findSearchTargetIndex(transcript, { snippet: 'DEPLOYMENT PIPELINES' });
  assert.equal(index, 2);
});

test('the sidebar ellipsis wrapper is stripped before matching', () => {
  const index = findSearchTargetIndex(transcript, { snippet: '...database indexing...' });
  assert.equal(index, 0);
});

test('a snippet that matches nothing reports a miss instead of guessing', () => {
  const index = findSearchTargetIndex(transcript, { snippet: 'something never said here' });
  assert.equal(index, -1, 'a miss must be -1 so the caller can decline to scroll');
});

test('a too-short snippet does not match by accident', () => {
  // Under the minimum length this would match almost anything.
  const index = findSearchTargetIndex(transcript, { snippet: 'the' });
  assert.equal(index, -1);
});

test('the timestamp resolves the target when no snippet is given', () => {
  const index = findSearchTargetIndex(transcript, { timestamp: '2024-01-01T10:05:01.000Z' });
  assert.equal(index, 1);
});

test('the timestamp is only a fallback when the snippet misses', () => {
  const index = findSearchTargetIndex(transcript, {
    snippet: 'not present anywhere',
    timestamp: '2024-01-01T10:10:00.000Z',
  });
  assert.equal(index, 2);
});

test('an empty transcript reports a miss', () => {
  assert.equal(findSearchTargetIndex([], { snippet: 'anything at all here' }), -1);
});

test('a target with neither snippet nor timestamp reports a miss', () => {
  assert.equal(findSearchTargetIndex(transcript, {}), -1);
});

test('tool output is searchable, since it is rendered text', () => {
  const withTool: ChatMessage[] = [
    message('intro text', '2024-01-01T10:00:00.000Z'),
    {
      type: 'tool',
      content: '',
      timestamp: '2024-01-01T10:01:00.000Z',
      isToolUse: true,
      toolName: 'Bash',
      toolInput: JSON.stringify({ command: 'npm run migrate:database' }),
    },
  ];

  assert.equal(findSearchTargetIndex(withTool, { snippet: 'npm run migrate:database' }), 1);
});

test('a tool result is searchable', () => {
  const withResult: ChatMessage[] = [
    {
      type: 'tool',
      content: '',
      timestamp: '2024-01-01T10:01:00.000Z',
      toolResult: { content: 'migration applied successfully', isError: false },
    },
  ];

  assert.equal(findSearchTargetIndex(withResult, { snippet: 'migration applied successfully' }), 0);
});

test('an unparsable timestamp does not crash the nearest search', () => {
  const withBadTimestamp: ChatMessage[] = [
    message('first', 'not-a-date'),
    message('second', '2024-01-01T10:00:00.000Z'),
  ];

  assert.equal(findSearchTargetIndex(withBadTimestamp, { timestamp: '2024-01-01T10:00:00.000Z' }), 1);
});

test('only the leading part of an over-long snippet has to match', () => {
  // The sidebar sends an elided fragment; matching is capped at 80 characters,
  // so a hit whose first 80 characters match is found even if the tail differs.
  const head = 'a'.repeat(80);
  const messages: ChatMessage[] = [message(`${head}TAIL-IN-TRANSCRIPT`, '2024-01-01T10:00:00.000Z')];

  assert.equal(findSearchTargetIndex(messages, { snippet: `${head}DIFFERENT-TAIL` }), 0);
});

test('the search window covers the resolved target plus trailing context', () => {
  // visibleMessages is a tail slice, so covering index N means rendering
  // everything after it.
  assert.equal(resolveSearchWindowSize(100, 99, 20), 21, 'newest message needs a small window');
  assert.equal(resolveSearchWindowSize(100, 0, 20), 120, 'oldest message needs the whole list');
  assert.equal(resolveSearchWindowSize(100, 50, 20), 70);
});

test('the window always includes the target itself', () => {
  const messageCount = 40;
  for (let targetIndex = 0; targetIndex < messageCount; targetIndex++) {
    const windowSize = resolveSearchWindowSize(messageCount, targetIndex, 0);
    const firstRenderedIndex = messageCount - windowSize;
    assert.ok(
      firstRenderedIndex <= targetIndex,
      `target ${targetIndex} fell outside a window of ${windowSize}`,
    );
  }
});
