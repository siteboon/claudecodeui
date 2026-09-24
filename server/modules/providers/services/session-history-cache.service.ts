import fsp from 'node:fs/promises';

import type { FetchHistoryResult } from '@/shared/types.js';

/**
 * Full-transcript cache for session history reads.
 *
 * Every provider history reader materializes the complete normalized
 * transcript and then slices out the requested page, so serving a 20-row page
 * of a large session re-read and re-parsed the whole transcript file on every
 * request — opening a session, each older page while scrolling up, and every
 * post-turn refresh. For a multi-megabyte JSONL that is most of a second of
 * CPU per request.
 *
 * Entries are keyed by app session id and validated with one `stat` per
 * request against the transcript file's identity (path + mtime + size), so
 * only the first read after the file changes pays the parse. Anything that
 * rewrites history (a new turn, an edit, a rewind, a fork) touches the file
 * and invalidates naturally.
 *
 * One thing the file cannot tell: whether the CLI process behind the session
 * is still running. Claude's history reader answers a background agent's
 * status from that, so a session's entry is also dropped explicitly when its
 * process starts or ends (`invalidate`) — otherwise a page read while the
 * process was up would keep reporting `running` after it had gone, until the
 * next row happened to land in the file. Codex's runtime invalidates for a
 * similar reason after it keeps a prompt the rollout never recorded: that
 * prompt lives in the app DB, so the file's stat does not change.
 *
 * Only history readers that read `jsonl_path` itself may use this cache —
 * callers pass `transcriptPath: null` for providers whose messages live
 * elsewhere (Cursor's store.db, OpenCode's shared SQLite), which bypasses
 * caching entirely.
 */

type CacheEntry = {
  transcriptPath: string;
  mtimeMs: number;
  /** File size in bytes; doubles as the entry's cost against the byte budget. */
  size: number;
  full: FetchHistoryResult;
};

type GetFullHistoryArgs = {
  sessionId: string;
  /** Path of the file the provider's history reader actually parses, or null to bypass. */
  transcriptPath: string | null | undefined;
  /** Loads the complete transcript (`limit: null, offset: 0`) from the provider. */
  loadFull: () => Promise<FetchHistoryResult>;
};

/**
 * A transcript entry's heap cost is roughly the file it was parsed from, so
 * the budget is expressed in file bytes. The newest entry is always retained
 * even when it alone exceeds the budget — evicting it would just re-parse the
 * same file on the next request.
 */
const MAX_CACHED_TRANSCRIPT_FILE_BYTES = 256 * 1024 * 1024;
const MAX_CACHE_ENTRIES = 8;

export function createSessionHistoryCache(
  maxTotalFileBytes = MAX_CACHED_TRANSCRIPT_FILE_BYTES,
  maxEntries = MAX_CACHE_ENTRIES,
) {
  const entries = new Map<string, CacheEntry>();
  const pendingLoads = new Map<string, Promise<FetchHistoryResult>>();
  // Loads that were already running when their session was invalidated. They
  // may have read state from before the change that prompted the invalidation,
  // which the file's stat cannot show, so their result is never cached.
  const staleLoads = new WeakSet<Promise<FetchHistoryResult>>();

  function evictOverBudget(): void {
    let totalBytes = 0;
    for (const entry of entries.values()) {
      totalBytes += entry.size;
    }
    for (const key of entries.keys()) {
      if (entries.size <= 1 || (totalBytes <= maxTotalFileBytes && entries.size <= maxEntries)) {
        break;
      }
      totalBytes -= entries.get(key)!.size;
      entries.delete(key);
    }
  }

  return {
    /**
     * Returns the session's full transcript through the cache, or null when
     * the session is not cacheable (no transcript path, or the file cannot be
     * stat'ed) — the caller then falls back to a plain provider read.
     */
    async getFullHistory({ sessionId, transcriptPath, loadFull }: GetFullHistoryArgs): Promise<FetchHistoryResult | null> {
      if (!transcriptPath) {
        return null;
      }

      let stat;
      try {
        stat = await fsp.stat(transcriptPath);
      } catch {
        entries.delete(sessionId);
        return null;
      }
      if (!stat.isFile()) {
        entries.delete(sessionId);
        return null;
      }

      const cached = entries.get(sessionId);
      if (
        cached
        && cached.transcriptPath === transcriptPath
        && cached.mtimeMs === stat.mtimeMs
        && cached.size === stat.size
      ) {
        // Re-insert to mark as most recently used.
        entries.delete(sessionId);
        entries.set(sessionId, cached);
        return cached.full;
      }

      // Concurrent requests for the same session share one parse. The file may
      // gain rows while the load runs; the pre-load stat is what the entry is
      // keyed by, so the next request would see a changed stat and re-read.
      const pending = pendingLoads.get(sessionId);
      if (pending) {
        return pending;
      }

      const load: Promise<FetchHistoryResult> = loadFull().then((full) => {
        if (!staleLoads.has(load)) {
          entries.delete(sessionId);
          entries.set(sessionId, {
            transcriptPath,
            mtimeMs: stat.mtimeMs,
            size: stat.size,
            full,
          });
          evictOverBudget();
        }
        return full;
      });
      pendingLoads.set(sessionId, load);
      try {
        return await load;
      } finally {
        if (pendingLoads.get(sessionId) === load) {
          pendingLoads.delete(sessionId);
        }
      }
    },

    /**
     * Forgets a session's entry so the next read re-parses its transcript. A
     * load already in flight still answers the requests that joined it, but
     * later requests start a fresh one and its result is not cached.
     */
    invalidate(sessionId: string): void {
      entries.delete(sessionId);
      const pending = pendingLoads.get(sessionId);
      if (pending) {
        staleLoads.add(pending);
        pendingLoads.delete(sessionId);
      }
    },
  };
}

export const sessionHistoryCache = createSessionHistoryCache();
