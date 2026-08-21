import assert from 'node:assert/strict';

import { test } from 'vitest';

import {
  findSearchTargetIndex,
  normalizeSearchSnippet,
} from '@/modules/chat/utils/searchTargetLocator';
import type { ChatMessage } from '@/shared/types';

/**
 * The sidebar search jump used to render the whole transcript and then scan the
 * DOM for the snippet, falling back to the nearest rendered timestamp. When the
 * hit was not on screen that fallback scrolled somewhere plausible and flashed
 * the highlight, telling the user they had been taken to their result when they
 * had not. Resolving the index from the data makes a miss detectable.
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

test('normalizeSearchSnippet caps the fragment length', () => {
  const long = 'x'.repeat(200);
  assert.equal(normalizeSearchSnippet(long).length, 80);
});
