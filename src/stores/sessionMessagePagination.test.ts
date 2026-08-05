import assert from 'node:assert/strict';
import test from 'node:test';

import type { NormalizedMessage } from './useSessionStore';
import {
  buildSessionMessagesUrl,
  findLatestPageOverlapLength,
  hasReachedCachedTailTimeBoundary,
  mergeLatestServerPage,
  mergeOlderServerPage,
  planLatestPageBridge,
  resolveLatestPagePagination,
} from './sessionMessagePagination';

function message(
  number: number,
  overrides: Partial<NormalizedMessage> = {},
): NormalizedMessage {
  return {
    id: `m${number}`,
    sessionId: 'session-1',
    timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, number)).toISOString(),
    provider: 'claude',
    kind: 'text',
    role: number % 2 === 0 ? 'assistant' : 'user',
    content: `message ${number}`,
    ...overrides,
  };
}

function range(start: number, end: number): NormalizedMessage[] {
  return Array.from({ length: end - start + 1 }, (_, index) => message(start + index));
}

test('automatic latest-history URL is explicitly bounded to the newest page', () => {
  assert.equal(
    buildSessionMessagesUrl('session/1', { limit: 20, offset: 0 }),
    '/api/providers/sessions/session%2F1/messages?limit=20&offset=0',
  );
});

test('overlapping latest page retains loaded older messages and replaces the tail', () => {
  const cached = range(21, 40);
  const latest = range(31, 50);
  latest[0] = { ...latest[0], content: 'fresh persisted value' };

  const result = mergeLatestServerPage(cached, latest);

  assert.equal(result.overlapLength, 10);
  assert.deepEqual(result.messages.map((item) => item.id), range(21, 50).map((item) => item.id));
  assert.equal(result.messages[10].content, 'fresh persisted value');
  assert.equal(new Set(result.messages.map((item) => item.id)).size, result.messages.length);
});

test('Codex rows with regenerated IDs overlap by stable transcript fields', () => {
  const cached = range(1, 20).map((item) => ({
    ...item,
    id: `codex-old-${item.id}`,
    provider: 'codex' as const,
  }));
  const latest = range(11, 30).map((item) => ({
    ...item,
    id: `codex-new-${item.id}`,
    provider: 'codex' as const,
  }));

  assert.equal(findLatestPageOverlapLength(cached, latest), 10);
  const merged = mergeLatestServerPage(cached, latest);
  assert.equal(merged.messages.length, 30);
  assert.deepEqual(
    merged.messages.slice(0, 10).map((item) => item.id),
    cached.slice(0, 10).map((item) => item.id),
  );
});

test('large appended turns request only the missing bridge and one anchor', () => {
  const cached = range(81, 100);
  const latest = range(106, 125);

  assert.deepEqual(planLatestPageBridge(cached, latest, 100, 125), {
    offset: 20,
    limit: 6,
  });

  const bridge = range(100, 105);
  const merged = mergeLatestServerPage(cached, [...bridge, ...latest]);
  assert.equal(merged.overlapLength, 1);
  assert.deepEqual(merged.messages.map((item) => item.id), range(81, 125).map((item) => item.id));
});

test('tool-result totals walk bounded bridge chunks until a contiguous anchor', () => {
  const cached = range(81, 100);
  const latest = range(106, 125);

  // Claude reports only 15 renderable additions for a 25-row normalized turn.
  assert.deepEqual(planLatestPageBridge(cached, latest, 100, 115), {
    offset: 20,
    limit: 1,
  });
  assert.deepEqual(planLatestPageBridge(cached, latest, 100, 115, 1), {
    offset: 21,
    limit: 20,
  });
  assert.deepEqual(planLatestPageBridge(cached, latest, 100, 115, 21), {
    offset: 41,
    limit: 20,
  });

  const firstBridgeChunk = range(105, 105);
  const secondBridgeChunk = range(85, 104);
  const merged = mergeLatestServerPage(
    cached,
    [...secondBridgeChunk, ...firstBridgeChunk, ...latest],
  );

  assert.equal(merged.overlapLength, 16);
  assert.deepEqual(merged.messages.map((item) => item.id), range(81, 125).map((item) => item.id));
});

test('bridge discovery stops after crossing the cached tail time boundary', () => {
  const cached = range(81, 100);

  assert.equal(hasReachedCachedTailTimeBoundary(cached, range(101, 120)), false);
  assert.equal(hasReachedCachedTailTimeBoundary(cached, range(95, 114)), true);
});

test('older-page reconciliation removes overlap caused by tail growth', () => {
  const cached = range(81, 100);
  const shiftedOlderPage = range(66, 85);
  const result = mergeOlderServerPage(cached, shiftedOlderPage);

  assert.equal(result.overlapLength, 5);
  assert.equal(result.prependedCount, 15);
  assert.deepEqual(result.messages.map((item) => item.id), range(66, 100).map((item) => item.id));
  assert.equal(new Set(result.messages.map((item) => item.id)).size, result.messages.length);
});

test('normal non-overlapping older pages prepend unchanged', () => {
  const cached = range(81, 100);
  const older = range(61, 80);
  const result = mergeOlderServerPage(cached, older);

  assert.equal(result.overlapLength, 0);
  assert.equal(result.prependedCount, 20);
  assert.deepEqual(result.messages.map((item) => item.id), range(61, 100).map((item) => item.id));
});

test('a disjoint fetched window is never concatenated onto cached history', () => {
  const cached = range(1, 20);
  const disjoint = range(30, 49);
  const merged = mergeLatestServerPage(cached, disjoint);

  assert.equal(merged.overlapLength, 0);
  assert.equal(merged.messages, cached);
});

test('pagination preserves partial and fully-loaded oldest-page boundaries', () => {
  assert.deepEqual(resolveLatestPagePagination(20, 30, true, true), {
    offset: 30,
    hasMore: true,
  });
  assert.deepEqual(resolveLatestPagePagination(40, 50, false, true), {
    offset: 50,
    hasMore: false,
  });
  assert.deepEqual(resolveLatestPagePagination(0, 20, false, true), {
    offset: 20,
    hasMore: true,
  });
});

test('offset counts loaded persisted rows even when renderable total excludes tool results', () => {
  const pagination = resolveLatestPagePagination(20, 23, true, true);
  const renderableTotal = 21;

  assert.equal(pagination.offset, 23);
  assert.ok(pagination.offset > renderableTotal);
});
