import type { IProviderSessions } from '@/shared/interfaces.js';
import type { FetchHistoryOptions, FetchHistoryResult, NormalizedMessage } from '@/shared/types.js';

/**
 * Phase 1 sessions placeholder for Pi.
 *
 * Live `pi --mode json` events and JSONL transcripts are normalized by the
 * sessions facet; until then the adapter reports "no messages" so history and
 * realtime consumers degrade to an empty transcript instead of failing.
 */
export class PiSessionsProvider implements IProviderSessions {
  normalizeMessage(): NormalizedMessage[] {
    return [];
  }

  async fetchHistory(
    _sessionId: string,
    _options?: FetchHistoryOptions,
  ): Promise<FetchHistoryResult> {
    return {
      messages: [],
      total: 0,
      hasMore: false,
      offset: 0,
      limit: null,
    };
  }
}
