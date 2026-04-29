import type { NormalizedMessage } from './useSessionStore';

/**
 * Merge an incoming page of server messages into the existing cached array,
 * deduped by id. Preserves any older history the user paginated into so an
 * SWR-style revalidate (which fetches only the latest N) doesn't clobber
 * earlier pages already loaded via fetchMore.
 */
export function mergeServerMessages(
  existing: NormalizedMessage[],
  incoming: NormalizedMessage[],
): NormalizedMessage[] {
  if (existing.length === 0) return incoming;
  if (incoming.length === 0) return existing;
  const incomingIds = new Set(incoming.map(m => m.id));
  const kept = existing.filter(m => !incomingIds.has(m.id));
  const combined = [...kept, ...incoming];
  combined.sort((a, b) => {
    const ta = a.timestamp || '';
    const tb = b.timestamp || '';
    if (ta < tb) return -1;
    if (ta > tb) return 1;
    return 0;
  });
  return combined;
}
