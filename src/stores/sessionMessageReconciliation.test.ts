import assert from 'node:assert/strict';
import test from 'node:test';

import type { NormalizedMessage } from './useSessionStore';
import {
  removeOptimisticUserEchoes,
  upsertRealtimeMessages,
} from './sessionMessageReconciliation';

const createUserMessage = (
  id: string,
  timestamp: string,
  overrides: Partial<NormalizedMessage> = {},
): NormalizedMessage => ({
  id,
  sessionId: 'session-1',
  timestamp,
  provider: 'claude',
  kind: 'text',
  role: 'user',
  content: '',
  ...overrides,
});

test('replaces an optimistic image-only turn with its persisted Claude copy', () => {
  const local = createUserMessage('local_image', '2026-07-28T20:30:21.000Z', {
    images: [{ path: 'C:/Users/test/.cloudcli/assets/upload.png', name: 'image.png' }],
  });
  const persisted = createUserMessage('claude_image', '2026-07-28T20:30:26.000Z', {
    images: [{ data: 'data:image/png;base64,AAAA' }],
  });

  assert.deepEqual(removeOptimisticUserEchoes([persisted], [local]), []);
});

test('does not collapse an attachment-only turn into a server row without attachments', () => {
  const local = createUserMessage('local_image', '2026-07-28T20:30:21.000Z', {
    images: [{ path: 'C:/Users/test/.cloudcli/assets/upload.png' }],
  });
  const persisted = createUserMessage('claude_empty', '2026-07-28T20:30:22.000Z');

  assert.deepEqual(removeOptimisticUserEchoes([persisted], [local]), [local]);
});

test('matches optimistic attachment turns to persisted turns one-to-one', () => {
  const firstLocal = createUserMessage('local_first', '2026-07-28T20:30:21.000Z', {
    images: [{ path: 'C:/Users/test/.cloudcli/assets/first.png' }],
  });
  const secondLocal = createUserMessage('local_second', '2026-07-28T20:30:25.000Z', {
    images: [{ path: 'C:/Users/test/.cloudcli/assets/second.png' }],
  });
  const firstPersisted = createUserMessage('claude_first', '2026-07-28T20:30:22.000Z', {
    images: [{ data: 'data:image/png;base64,AAAA' }],
  });

  const remainingRealtime = removeOptimisticUserEchoes(
    [firstPersisted],
    [firstLocal, secondLocal],
  );

  assert.deepEqual(remainingRealtime.map((message) => message.id), ['local_second']);
});

test('keeps the existing optimistic text reconciliation behavior', () => {
  const local = createUserMessage('local_text', '2026-07-28T20:30:21.000Z', {
    content: 'hello',
  });
  const persisted = createUserMessage('claude_text', '2026-07-28T20:30:26.000Z', {
    content: 'hello',
  });

  assert.deepEqual(removeOptimisticUserEchoes([persisted], [local]), []);
});

test('replaces repeated realtime snapshots with the same logical message id', () => {
  const base = createUserMessage('thinking-1', '2026-08-04T00:00:00.000Z', {
    provider: 'pi',
    kind: 'thinking',
    role: 'assistant',
    content: 'The',
    isStreaming: true,
    seq: 1,
  });
  const updated = {
    ...base,
    content: 'The answer',
    seq: 2,
  };
  const finalized = {
    ...updated,
    content: 'The authoritative answer',
    isStreaming: false,
    duration: 2,
    seq: 3,
  };

  const messages = upsertRealtimeMessages([], [base, updated, finalized]);

  assert.equal(messages.length, 1);
  assert.equal(messages[0]?.id, 'thinking-1');
  assert.equal(messages[0]?.content, 'The authoritative answer');
  assert.equal(messages[0]?.isStreaming, false);
  assert.equal(messages[0]?.duration, 2);
});

test('ignores an older sequenced snapshot for an existing realtime message', () => {
  const finalized = createUserMessage('thinking-1', '2026-08-04T00:00:00.000Z', {
    provider: 'pi',
    kind: 'thinking',
    role: 'assistant',
    content: 'complete',
    isStreaming: false,
    seq: 9,
  });
  const stale = {
    ...finalized,
    content: 'partial',
    isStreaming: true,
    seq: 8,
  };

  assert.deepEqual(upsertRealtimeMessages([finalized], [stale]), [finalized]);
});
