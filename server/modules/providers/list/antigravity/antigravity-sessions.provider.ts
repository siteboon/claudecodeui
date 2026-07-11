import type { IProviderSessions } from '@/shared/interfaces.js';
import type { FetchHistoryOptions, FetchHistoryResult, NormalizedMessage } from '@/shared/types.js';
import { createNormalizedMessage, generateMessageId, readObjectRecord, readOptionalString } from '@/shared/utils.js';

const PROVIDER = 'antigravity';

export class AntigravitySessionsProvider implements IProviderSessions {
  normalizeMessage(rawMessage: unknown, sessionId: string | null): NormalizedMessage[] {
    const raw = readObjectRecord(rawMessage);
    const content = typeof rawMessage === 'string'
      ? rawMessage
      : readOptionalString(raw?.content) ?? readOptionalString(raw?.text) ?? '';

    if (!content.trim()) {
      return [];
    }

    return [createNormalizedMessage({
      id: readOptionalString(raw?.id) ?? generateMessageId('antigravity'),
      sessionId,
      provider: PROVIDER,
      kind: 'stream_delta',
      content,
    })];
  }

  async fetchHistory(
    _sessionId: string,
    options: FetchHistoryOptions = {},
  ): Promise<FetchHistoryResult> {
    return {
      messages: [],
      total: 0,
      hasMore: false,
      offset: options.offset ?? 0,
      limit: options.limit ?? null,
    };
  }
}
