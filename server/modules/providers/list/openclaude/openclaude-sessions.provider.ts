import type { IProviderSessions } from '@/shared/interfaces.js';
import type { FetchHistoryOptions, FetchHistoryResult, NormalizedMessage } from '@/shared/types.js';

export class OpenClaudeSessionsProvider implements IProviderSessions {
  normalizeMessage(_raw: unknown, _sessionId: string | null): NormalizedMessage[] {
    return [];
  }

  async fetchHistory(
    _sessionId: string,
    _options?: FetchHistoryOptions,
  ): Promise<FetchHistoryResult> {
    return { messages: [], total: 0, hasMore: false, offset: 0, limit: null };
  }
}
