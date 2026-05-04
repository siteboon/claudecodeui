import type { IProviderSessions } from '@/shared/interfaces.js';
import type { FetchHistoryOptions, FetchHistoryResult, NormalizedMessage } from '@/shared/types.js';
import { createNormalizedMessage, readObjectRecord } from '@/shared/utils.js';

const PROVIDER = 'openclaude';

export class OpenClaudeSessionsProvider implements IProviderSessions {
  normalizeMessage(rawMessage: unknown, sessionId: string | null): NormalizedMessage[] {
    const raw = readObjectRecord(rawMessage);
    if (!raw?.type) return [];

    if (raw.type === 'assistant') {
      if (raw.subtype === 'text' || (!raw.subtype && typeof raw.content === 'string')) {
        return [createNormalizedMessage({
          kind: 'text',
          role: 'assistant',
          content: raw.content as string,
          sessionId,
          provider: PROVIDER,
        })];
      }

      if (raw.subtype === 'tool_use') {
        return [createNormalizedMessage({
          kind: 'tool_use',
          toolName: raw.tool_name as string,
          toolInput: raw.tool_input,
          toolId: raw.tool_use_id as string,
          sessionId,
          provider: PROVIDER,
        })];
      }

      if (raw.subtype === 'thinking') {
        return [createNormalizedMessage({
          kind: 'thinking',
          content: raw.content as string,
          sessionId,
          provider: PROVIDER,
        })];
      }
    }

    if (raw.type === 'tool_result') {
      return [createNormalizedMessage({
        kind: 'tool_result',
        toolId: raw.tool_use_id as string,
        content: raw.content as string,
        isError: !!raw.is_error,
        sessionId,
        provider: PROVIDER,
      })];
    }

    if (raw.type === 'user') {
      return [createNormalizedMessage({
        kind: 'text',
        role: 'user',
        content: raw.content as string,
        sessionId,
        provider: PROVIDER,
      })];
    }

    if (raw.type === 'error') {
      return [createNormalizedMessage({
        kind: 'error',
        content: (raw.message || raw.content || 'Unknown error') as string,
        sessionId,
        provider: PROVIDER,
      })];
    }

    if (raw.type === 'system' && raw.subtype === 'init') {
      return [createNormalizedMessage({
        kind: 'session_created',
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
    // OCC session history will be loaded from checkpoint files in Phase 7
    return { messages: [], total: 0, hasMore: false, offset: 0, limit: null };
  }
}
