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

test('invalidating a session re-parses its unchanged transcript on the next read', async () => {
  await withTranscriptFile(async (transcriptPath) => {
    const cache = createSessionHistoryCache();
    let loads = 0;
    const loadFull = async () => {
      loads += 1;
      return historyResult(`load-${loads}`);
    };

    // Claude's history reader decides a background agent's status from whether
    // the session's CLI process is up — nothing the file's stat can reflect —
    // so the runtime drops the entry when that process starts or ends.
    const first = await cache.getFullHistory({ sessionId: 's1', transcriptPath, loadFull });
    cache.invalidate('s1');
    const second = await cache.getFullHistory({ sessionId: 's1', transcriptPath, loadFull });

    assert.equal(loads, 2);
    assert.notEqual(second, first);
    assert.equal(second?.messages[0]?.content, 'load-2');
  });
});

type GatedLoader = {
  loadFull: () => Promise<FetchHistoryResult>;
  /** Resolves when load N (1-based) has been started. */
  started: (load: number) => Promise<void>;
  /** Lets gated load N finish, failing it when `fail` is set. */
  finish: (load: number, fail?: boolean) => void;
  loads: () => number;
};

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((settle) => { resolve = settle; });
  return { promise, resolve };
}

/** Loads 1 and 2 wait until finished by hand; any later load answers at once. */
function gatedLoader(): GatedLoader {
  let loads = 0;
  const starts = [0, 1].map(() => deferred<void>());
  const gates = [0, 1].map(() => deferred<boolean>());
  return {
    loadFull: async () => {
      loads += 1;
      const load = loads;
      if (load <= gates.length) {
        starts[load - 1].resolve();
        if (await gates[load - 1].promise) {
          throw new Error(`load-${load} failed`);
        }
      }
      return historyResult(`load-${load}`);
    },
    started: (load) => starts[load - 1].promise,
    finish: (load, fail = false) => gates[load - 1].resolve(fail),
    loads: () => loads,
  };
}

/** Waits for `promise`, but gives up after `ms` so a regression fails instead of hanging. */
async function within(promise: Promise<void>, ms: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([promise, new Promise<void>((resolve) => { timer = setTimeout(resolve, ms); })]);
  clearTimeout(timer);
}

async function settleIo(): Promise<void> {
  for (let round = 0; round < 30; round += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

test('a request after invalidate starts its own load, and the stale load does not overwrite it', async () => {
  await withTranscriptFile(async (transcriptPath) => {
    const cache = createSessionHistoryCache();
    const loader = gatedLoader();
    const read = () => cache.getFullHistory({ sessionId: 's1', transcriptPath, loadFull: loader.loadFull });

    // Codex's runtime stores a prompt the rollout lacks and then invalidates,
    // without touching the file: a load that read the store before that write
    // has the same stat as one that read it after.
    const staleRequest = read();
    await loader.started(1);
    cache.invalidate('s1');
    const freshRequest = read();

    await within(loader.started(2), 5000);
    assert.equal(loader.loads(), 2, 'the request after invalidate joined the stale load');

    loader.finish(2);
    assert.equal((await freshRequest)?.messages[0]?.content, 'load-2');
    // The stale load finishes last, after the fresh result is cached.
    loader.finish(1);
    assert.equal((await staleRequest)?.messages[0]?.content, 'load-1');

    assert.equal((await read())?.messages[0]?.content, 'load-2');
    assert.equal(loader.loads(), 2);
  });
});

test('a stale load that fails does not drop the fresh load other requests can join', async () => {
  await withTranscriptFile(async (transcriptPath) => {
    const cache = createSessionHistoryCache();
    const loader = gatedLoader();
    const read = () => cache.getFullHistory({ sessionId: 's1', transcriptPath, loadFull: loader.loadFull });

    const staleRequest = read();
    await loader.started(1);
    cache.invalidate('s1');
    const freshRequest = read();
    await within(loader.started(2), 5000);

    loader.finish(1, true);
    await assert.rejects(staleRequest, /load-1 failed/);

    const laterRequest = read();
    await settleIo();
    loader.finish(2);

    assert.equal((await freshRequest)?.messages[0]?.content, 'load-2');
    assert.equal((await laterRequest)?.messages[0]?.content, 'load-2');
    assert.equal(loader.loads(), 2);
  });
});
