import sessionManager from '@/sessionManager.js';
import { getGeminiCliSessionMessages } from '@/projects.js';
import type { IProviderSessions } from '@/shared/interfaces.js';
import type { AnyRecord, FetchHistoryOptions, FetchHistoryResult, NormalizedMessage } from '@/shared/types.js';
import { createNormalizedMessage, generateMessageId, readObjectRecord } from '@/shared/utils.js';

const PROVIDER = 'gemini';

export class GeminiSessionsProvider implements IProviderSessions {
  /**
   * Normalizes live Gemini stream-json events into the shared message shape.
   *
   * Gemini history uses a different session file shape, so fetchHistory handles
   * that separately after loading raw persisted messages.
   */
  normalizeMessage(rawMessage: unknown, sessionId: string | null): NormalizedMessage[] {
    const raw = readObjectRecord(rawMessage);
    if (!raw) {
      return [];
    }

    const ts = raw.timestamp || new Date().toISOString();
    const baseId = raw.uuid || generateMessageId('gemini');

    if (raw.type === 'message' && raw.role === 'assistant') {
      const content = raw.content || '';
      const messages: NormalizedMessage[] = [];
      if (content) {
        messages.push(createNormalizedMessage({
          id: baseId,
          sessionId,
          timestamp: ts,
          provider: PROVIDER,
          kind: 'stream_delta',
          content,
        }));
      }
      if (raw.delta !== true) {
        messages.push(createNormalizedMessage({
          sessionId,
          timestamp: ts,
          provider: PROVIDER,
          kind: 'stream_end',
        }));
      }
      return messages;
    }

    if (raw.type === 'tool_use') {
      return [createNormalizedMessage({
        id: baseId,
        sessionId,
        timestamp: ts,
        provider: PROVIDER,
        kind: 'tool_use',
        toolName: raw.tool_name,
        toolInput: raw.parameters || {},
        toolId: raw.tool_id || baseId,
      })];
    }

    if (raw.type === 'tool_result') {
      return [createNormalizedMessage({
        id: baseId,
        sessionId,
        timestamp: ts,
        provider: PROVIDER,
        kind: 'tool_result',
        toolId: raw.tool_id || '',
        content: raw.output === undefined ? '' : String(raw.output),
        isError: raw.status === 'error',
      })];
    }

    if (raw.type === 'result') {
      const messages = [createNormalizedMessage({
        sessionId,
        timestamp: ts,
        provider: PROVIDER,
        kind: 'stream_end',
      })];
      if (raw.stats?.total_tokens) {
        messages.push(createNormalizedMessage({
          sessionId,
          timestamp: ts,
          provider: PROVIDER,
          kind: 'status',
          text: 'Complete',
          tokens: raw.stats.total_tokens,
          canInterrupt: false,
        }));
      }
      return messages;
    }

    if (raw.type === 'error') {
      return [createNormalizedMessage({
        id: baseId,
        sessionId,
        timestamp: ts,
        provider: PROVIDER,
        kind: 'error',
        content: raw.error || raw.message || 'Unknown Gemini streaming error',
      })];
    }

    return [];
  }

  /**
   * Loads Gemini history from the in-memory session manager first, then falls
   * back to Gemini CLI session files on disk.
   */
  async fetchHistory(
    sessionId: string,
    options: FetchHistoryOptions = {},
  ): Promise<FetchHistoryResult> {
    const { limit = null, offset = 0 } = options;

    let rawMessages: AnyRecord[];
    try {
      rawMessages = sessionManager.getSessionMessages(sessionId) as AnyRecord[];

      if (rawMessages.length === 0) {
        rawMessages = await getGeminiCliSessionMessages(sessionId) as AnyRecord[];
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[GeminiProvider] Failed to load session ${sessionId}:`, message);
      return { messages: [], total: 0, hasMore: false, offset: 0, limit: null };
    }

    const normalized: NormalizedMessage[] = [];
    for (let i = 0; i < rawMessages.length; i++) {
      const raw = rawMessages[i];
      const ts = raw.timestamp || new Date().toISOString();
      const baseId = raw.uuid || generateMessageId('gemini');

      const role = raw.message?.role || raw.role;
      const content = raw.message?.content || raw.content;

      if (!role || !content) {
        continue;
      }

      const normalizedRole = role === 'user' ? 'user' : 'assistant';

      if (Array.isArray(content)) {
        for (let partIdx = 0; partIdx < content.length; partIdx++) {
          const part = content[partIdx];
          if (part.type === 'text' && part.text) {
            normalized.push(createNormalizedMessage({
              id: `${baseId}_${partIdx}`,
              sessionId,
              timestamp: ts,
              provider: PROVIDER,
              kind: 'text',
              role: normalizedRole,
              content: part.text,
            }));
          } else if (part.type === 'tool_use') {
            normalized.push(createNormalizedMessage({
              id: `${baseId}_${partIdx}`,
              sessionId,
              timestamp: ts,
              provider: PROVIDER,
              kind: 'tool_use',
              toolName: part.name,
              toolInput: part.input,
              toolId: part.id || generateMessageId('gemini_tool'),
            }));
          } else if (part.type === 'tool_result') {
            normalized.push(createNormalizedMessage({
              id: `${baseId}_${partIdx}`,
              sessionId,
              timestamp: ts,
              provider: PROVIDER,
              kind: 'tool_result',
              toolId: part.tool_use_id || '',
              content: part.content === undefined ? '' : String(part.content),
              isError: Boolean(part.is_error),
            }));
          }
        }
      } else if (typeof content === 'string' && content.trim()) {
        normalized.push(createNormalizedMessage({
          id: baseId,
          sessionId,
          timestamp: ts,
          provider: PROVIDER,
          kind: 'text',
          role: normalizedRole,
          content,
        }));
      }
    }

    const toolResultMap = new Map<string, NormalizedMessage>();
    for (const msg of normalized) {
      if (msg.kind === 'tool_result' && msg.toolId) {
        toolResultMap.set(msg.toolId, msg);
      }
    }
    for (const msg of normalized) {
      if (msg.kind === 'tool_use' && msg.toolId && toolResultMap.has(msg.toolId)) {
        const toolResult = toolResultMap.get(msg.toolId);
        if (toolResult) {
          msg.toolResult = { content: toolResult.content, isError: toolResult.isError };
        }
      }
    }

    const start = Math.max(0, offset);
    const pageLimit = limit === null ? null : Math.max(0, limit);
    const messages = pageLimit === null
      ? normalized.slice(start)
      : normalized.slice(start, start + pageLimit);

    return {
      messages,
      total: normalized.length,
      hasMore: pageLimit === null ? false : start + pageLimit < normalized.length,
      offset: start,
      limit: pageLimit,
    };
  }
}
