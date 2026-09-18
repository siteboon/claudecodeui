import assert from 'node:assert/strict';
import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createSessionHistoryCache } from '@/modules/providers/services/session-history-cache.service.js';
import type { FetchHistoryResult, NormalizedMessage } from '@/shared/types.js';

function historyResult(marker: string): FetchHistoryResult {
  const message = {
    id: marker,
    sessionId: 'session',
    timestamp: '2026-01-01T00:00:00.000Z',
    provider: 'claude',
    kind: 'text',
    role: 'user',
    content: marker,
  } as NormalizedMessage;

  return { messages: [message], total: 1, hasMore: false, offset: 0, limit: null };
}

async function withTranscriptFile(
  runTest: (transcriptPath: string) => Promise<void>,
): Promise<void> {
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'session-history-cache-'));
  const transcriptPath = path.join(tempDirectory, 'session.jsonl');
  await writeFile(transcriptPath, '{"type":"user"}\n', 'utf8');
  try {
    await runTest(transcriptPath);
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

test('an unchanged transcript file is loaded once and then served from cache', async () => {
  await withTranscriptFile(async (transcriptPath) => {
    const cache = createSessionHistoryCache();
    let loads = 0;
    const loadFull = async () => {
      loads += 1;
      return historyResult(`load-${loads}`);
    };

    const first = await cache.getFullHistory({ sessionId: 's1', transcriptPath, loadFull });
    const second = await cache.getFullHistory({ sessionId: 's1', transcriptPath, loadFull });

    assert.equal(loads, 1);
    assert.equal(second, first);
  });
});

test('growing the transcript file invalidates the cached load', async () => {
  await withTranscriptFile(async (transcriptPath) => {
    const cache = createSessionHistoryCache();
    let loads = 0;
    const loadFull = async () => {
      loads += 1;
      return historyResult(`load-${loads}`);
    };

    await cache.getFullHistory({ sessionId: 's1', transcriptPath, loadFull });
    await appendFile(transcriptPath, '{"type":"assistant"}\n', 'utf8');
    const afterAppend = await cache.getFullHistory({ sessionId: 's1', transcriptPath, loadFull });

    assert.equal(loads, 2);
    assert.equal(afterAppend?.messages[0]?.id, 'load-2');
  });
});

test('a missing transcript path or file bypasses the cache', async () => {
  const cache = createSessionHistoryCache();
  let loads = 0;
  const loadFull = async () => {
    loads += 1;
    return historyResult('unused');
  };

  assert.equal(await cache.getFullHistory({ sessionId: 's1', transcriptPath: null, loadFull }), null);
  assert.equal(
    await cache.getFullHistory({
      sessionId: 's1',
      transcriptPath: path.join(os.tmpdir(), 'session-history-cache-does-not-exist.jsonl'),
      loadFull,
    }),
    null,
  );
  assert.equal(loads, 0);
});

test('concurrent misses share a single load', async () => {
  await withTranscriptFile(async (transcriptPath) => {
    const cache = createSessionHistoryCache();
    let loads = 0;
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const loadFull = async () => {
      loads += 1;
      await gate;
      return historyResult(`load-${loads}`);
    };

    const firstRequest = cache.getFullHistory({ sessionId: 's1', transcriptPath, loadFull });
    const secondRequest = cache.getFullHistory({ sessionId: 's1', transcriptPath, loadFull });
    release!();
    const [first, second] = await Promise.all([firstRequest, secondRequest]);

    assert.equal(loads, 1);
    assert.equal(second, first);
  });
});

test('the oldest entries are evicted over budget, but the newest survives alone', async () => {
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'session-history-cache-evict-'));
  try {
    const firstPath = path.join(tempDirectory, 'first.jsonl');
    const secondPath = path.join(tempDirectory, 'second.jsonl');
    // Each file is 100 bytes, so a 150-byte budget holds exactly one entry —
    // and the newest entry stays cached even though it exceeds nothing alone.
    await writeFile(firstPath, 'x'.repeat(100), 'utf8');
    await writeFile(secondPath, 'y'.repeat(100), 'utf8');

    const cache = createSessionHistoryCache(150);
    const loadsBySession = new Map<string, number>();
    const loaderFor = (sessionId: string) => async () => {
      loadsBySession.set(sessionId, (loadsBySession.get(sessionId) ?? 0) + 1);
      return historyResult(sessionId);
    };

    await cache.getFullHistory({ sessionId: 's1', transcriptPath: firstPath, loadFull: loaderFor('s1') });
    await cache.getFullHistory({ sessionId: 's2', transcriptPath: secondPath, loadFull: loaderFor('s2') });

    // s2 is still cached; s1 was evicted to fit the budget.
    await cache.getFullHistory({ sessionId: 's2', transcriptPath: secondPath, loadFull: loaderFor('s2') });
    await cache.getFullHistory({ sessionId: 's1', transcriptPath: firstPath, loadFull: loaderFor('s1') });

    assert.equal(loadsBySession.get('s2'), 1);
    assert.equal(loadsBySession.get('s1'), 2);
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
});
