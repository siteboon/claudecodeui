import type { IProviderSessions } from '@/shared/interfaces.js';
import type { FetchHistoryOptions, FetchHistoryResult, NormalizedMessage } from '@/shared/types.js';
import { createNormalizedMessage, readObjectRecord } from '@/shared/utils.js';

const PROVIDER = 'crewai';

export class CrewAISessionsProvider implements IProviderSessions {
  normalizeMessage(rawMessage: unknown, sessionId: string | null): NormalizedMessage[] {
    const raw = readObjectRecord(rawMessage);
    if (!raw?.type) return [];

    if (raw.type === 'status') {
      return [createNormalizedMessage({
        kind: 'text',
        role: 'assistant',
        content: raw.message as string,
        sessionId,
        provider: PROVIDER,
      })];
    }

    if (raw.type === 'result') {
      return [createNormalizedMessage({
        kind: 'text',
        role: 'assistant',
        content: raw.output as string,
        sessionId,
        provider: PROVIDER,
      })];
    }

    if (raw.type === 'error') {
      return [createNormalizedMessage({
        kind: 'error',
        content: (raw.message || raw.detail || 'Unknown error') as string,
        sessionId,
        provider: PROVIDER,
      })];
    }

    if (raw.type === 'task_started' || raw.type === 'task_completed') {
      return [createNormalizedMessage({
        kind: 'text',
        role: 'assistant',
        content: `[${raw.type}] ${raw.task_name || raw.message || ''}`,
        sessionId,
        provider: PROVIDER,
      })];
    }

    return [];
  }

  async fetchHistory(
    _sessionId: string,
    _options: FetchHistoryOptions = {},
  ): Promise<FetchHistoryResult> {
    return { messages: [], total: 0, hasMore: false, offset: 0, limit: null };
  }
}
