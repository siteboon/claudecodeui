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
 * next row happened to land in the file.
 *
 * Only history readers that read `jsonl_path` itself may use this cache —
 * callers pass `transcriptPath: null` for providers whose messages live
 * elsewhere (Cursor's store.db, OpenCode's shared SQLite), which bypasses
 * caching entirely.
 *
 * A reader that also parses other files names them through
 * `listDependencies`, and their identities are part of the entry's key too.
 * Claude's does: a background agent writes its steps to a transcript of its
 * own while the session's file stays untouched until it reports back.
 */

type FileIdentity = {
  path: string;
  mtimeMs: number;
  size: number;
};

type CacheEntry = {
  transcriptPath: string;
  mtimeMs: number;
  /** File size in bytes; doubles as the entry's cost against the byte budget. */
  size: number;
  /** The other files the history was read from, as they were when it was loaded. */
  dependencies: FileIdentity[];
  full: FetchHistoryResult;
};

type GetFullHistoryArgs = {
  sessionId: string;
  /** Path of the file the provider's history reader actually parses, or null to bypass. */
  transcriptPath: string | null | undefined;
  /** Loads the complete transcript (`limit: null, offset: 0`) from the provider. */
  loadFull: () => Promise<FetchHistoryResult>;
  /** Other files the history reader parses; a path that does not exist yet still counts once it appears. */
  listDependencies?: () => Promise<string[]>;
};

/** Identities of the dependency files that exist right now, in listing order. */
async function readDependencyIdentities(listDependencies: GetFullHistoryArgs['listDependencies']): Promise<FileIdentity[]> {
  if (!listDependencies) {
    return [];
  }
  const paths = await listDependencies();
  const identities = await Promise.all(paths.map(async (dependencyPath) => {
    try {
      const stat = await fsp.stat(dependencyPath);
      return stat.isFile() ? { path: dependencyPath, mtimeMs: stat.mtimeMs, size: stat.size } : null;
    } catch {
      return null;
    }
  }));
  return identities.filter((identity): identity is FileIdentity => identity !== null);
}

function sameIdentities(left: FileIdentity[], right: FileIdentity[]): boolean {
  return left.length === right.length && left.every((identity, index) =>
    identity.path === right[index].path
    && identity.mtimeMs === right[index].mtimeMs
    && identity.size === right[index].size);
}

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
    async getFullHistory({ sessionId, transcriptPath, loadFull, listDependencies }: GetFullHistoryArgs): Promise<FetchHistoryResult | null> {
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

      const dependencies = await readDependencyIdentities(listDependencies);
      const cached = entries.get(sessionId);
      if (
        cached
        && cached.transcriptPath === transcriptPath
        && cached.mtimeMs === stat.mtimeMs
        && cached.size === stat.size
        && sameIdentities(cached.dependencies, dependencies)
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

      const load = loadFull().then((full) => {
        entries.delete(sessionId);
        entries.set(sessionId, {
          transcriptPath,
          mtimeMs: stat.mtimeMs,
          size: stat.size,
          dependencies,
          full,
        });
        evictOverBudget();
        return full;
      });
      pendingLoads.set(sessionId, load);
      try {
        return await load;
      } finally {
        pendingLoads.delete(sessionId);
      }
    },

    /** Forgets a session's entry so the next read re-parses its transcript. */
    invalidate(sessionId: string): void {
      entries.delete(sessionId);
    },
  };
}

export const sessionHistoryCache = createSessionHistoryCache();
