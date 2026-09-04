import type { NormalizedMessage } from '@/shared/types';

export const SESSION_MESSAGES_PAGE_SIZE = 20;

export type SessionMessagesRequestOptions = {
  limit?: number | null;
  offset?: number;
};

export type LatestPageMergeResult = {
  messages: NormalizedMessage[];
  overlapLength: number;
};

export type LatestPageBridgeRequest = {
  limit: number;
  offset: number;
};

export type LatestPagePagination = {
  offset: number;
  hasMore: boolean;
};

export type OlderPageMergeResult = {
  messages: NormalizedMessage[];
  overlapLength: number;
  prependedCount: number;
};

// The unified session-history URL is declared with the rest of the endpoints;
// it is re-exported here because the pagination tests cover its shape.
export { sessionMessagesUrl as buildSessionMessagesUrl } from '@/shared/api';

function serializedValue(value: unknown): string {
  if (value === undefined) return '';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Persisted IDs are preferred, but some provider readers (notably Codex)
 * generate fresh IDs on every read. The fallback uses stable transcript fields
 * and deliberately excludes enrichment such as toolResult, which may change
 * when the provider finishes writing a turn.
 */
export function messagesRepresentSamePersistedRow(
  first: NormalizedMessage,
  second: NormalizedMessage,
): boolean {
  if (first.id === second.id) return true;
  if (
    first.provider !== second.provider
    || first.kind !== second.kind
    || first.timestamp !== second.timestamp
    || first.role !== second.role
  ) {
    return false;
  }

  if (first.toolId || second.toolId) return first.toolId === second.toolId;
  if (first.rowid !== undefined || second.rowid !== undefined) return first.rowid === second.rowid;
  if (first.sequence !== undefined || second.sequence !== undefined) return first.sequence === second.sequence;

  return (
    (first.content ?? '') === (second.content ?? '')
    && (first.text ?? '') === (second.text ?? '')
    && (first.toolName ?? '') === (second.toolName ?? '')
    && (first.commandName ?? '') === (second.commandName ?? '')
    && (first.parentToolUseId ?? '') === (second.parentToolUseId ?? '')
    && serializedValue(first.toolInput) === serializedValue(second.toolInput)
  );
}

/** Returns the longest cached-suffix/latest-prefix overlap. */
export function findLatestPageOverlapLength(
  cachedMessages: NormalizedMessage[],
  latestMessages: NormalizedMessage[],
): number {
  const maximum = Math.min(cachedMessages.length, latestMessages.length);

  for (let length = maximum; length > 0; length--) {
    const cachedStart = cachedMessages.length - length;
    let matches = true;
    for (let index = 0; index < length; index++) {
      if (!messagesRepresentSamePersistedRow(cachedMessages[cachedStart + index], latestMessages[index])) {
        matches = false;
        break;
      }
    }
    if (matches) return length;
  }

  return 0;
}

/**
 * Plans the next finite bridge chunk when a single turn added at least one
 * complete latest page. The common case asks for exactly the reported missing
 * rows plus one anchor; later chunks handle provider totals that omit rows.
 */
export function planLatestPageBridge(
  cachedMessages: NormalizedMessage[],
  latestMessages: NormalizedMessage[],
  previousTotal: number,
  nextTotal: number,
  bridgeRowsFetched = 0,
): LatestPageBridgeRequest | null {
  if (
    cachedMessages.length === 0
    || latestMessages.length === 0
    || findLatestPageOverlapLength(cachedMessages, latestMessages) > 0
  ) {
    return null;
  }

  const addedCount = Math.max(0, nextTotal - previousTotal);
  const predictedMissingRows = Math.max(
    0,
    addedCount - latestMessages.length - bridgeRowsFetched,
  );
  const preferredLimit = bridgeRowsFetched === 0
    ? Math.max(1, predictedMissingRows + 1)
    : SESSION_MESSAGES_PAGE_SIZE;

  return {
    offset: latestMessages.length + bridgeRowsFetched,
    limit: preferredLimit,
  };
}

/**
 * Returns true once a backward bridge has reached the time range already
 * represented by the cached tail. This prevents a rewritten transcript with
 * no semantic ID overlap from walking backward through old history forever.
 */
export function hasReachedCachedTailTimeBoundary(
  cachedMessages: NormalizedMessage[],
  fetchedMessages: NormalizedMessage[],
): boolean {
  const cachedNewest = cachedMessages[cachedMessages.length - 1];
  const fetchedOldest = fetchedMessages[0];
  if (!cachedNewest || !fetchedOldest) return false;

  const cachedNewestTime = Date.parse(cachedNewest.timestamp);
  const fetchedOldestTime = Date.parse(fetchedOldest.timestamp);
  if (!Number.isFinite(cachedNewestTime) || !Number.isFinite(fetchedOldestTime)) {
    return false;
  }

  return fetchedOldestTime <= cachedNewestTime;
}

/**
 * Atomically replaces the overlapping cached tail with the latest persisted
 * window while retaining every already-loaded older row.
 */
export function mergeLatestServerPage(
  cachedMessages: NormalizedMessage[],
  latestMessages: NormalizedMessage[],
): LatestPageMergeResult {
  if (cachedMessages.length === 0) {
    return { messages: latestMessages, overlapLength: 0 };
  }
  if (latestMessages.length === 0) {
    return { messages: cachedMessages, overlapLength: 0 };
  }

  const overlapLength = findLatestPageOverlapLength(cachedMessages, latestMessages);
  if (overlapLength === 0) {
    return { messages: cachedMessages, overlapLength: 0 };
  }

  return {
    messages: [
      ...cachedMessages.slice(0, cachedMessages.length - overlapLength),
      ...latestMessages,
    ],
    overlapLength,
  };
}

/**
 * Reconciles a tail-offset older-page response with the cached suffix when the
 * transcript grew while that request was in flight. With no overlap the page
 * is treated as the normal immediately-preceding page.
 */
export function mergeOlderServerPage(
  cachedMessages: NormalizedMessage[],
  olderMessages: NormalizedMessage[],
): OlderPageMergeResult {
  const maximum = Math.min(cachedMessages.length, olderMessages.length);
  let overlapLength = 0;

  for (let length = maximum; length > 0; length--) {
    const olderStart = olderMessages.length - length;
    let matches = true;
    for (let index = 0; index < length; index++) {
      if (!messagesRepresentSamePersistedRow(olderMessages[olderStart + index], cachedMessages[index])) {
        matches = false;
        break;
      }
    }
    if (matches) {
      overlapLength = length;
      break;
    }
  }

  const prependedCount = olderMessages.length - overlapLength;
  return {
    messages: [
      ...olderMessages.slice(0, prependedCount),
      ...cachedMessages,
    ],
    overlapLength,
    prependedCount,
  };
}

/** Preserves the cached oldest-page boundary after a successful tail stitch. */
export function resolveLatestPagePagination(
  previousMessageCount: number,
  mergedMessageCount: number,
  previousHasMore: boolean,
  oldestFetchedPageHasMore: boolean,
): LatestPagePagination {
  return {
    offset: mergedMessageCount,
    hasMore: previousMessageCount === 0
      ? oldestFetchedPageHasMore
      : previousHasMore && oldestFetchedPageHasMore,
  };
}
