import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import readline from 'node:readline';

import { sessionsDb } from '@/modules/database/index.js';
import type { IProviderSessions } from '@/shared/interfaces.js';
import type { AnyRecord, FetchHistoryOptions, FetchHistoryResult, NormalizedMessage } from '@/shared/types.js';
import { createNormalizedMessage, generateMessageId, readObjectRecord } from '@/shared/utils.js';

const PROVIDER = 'gemini';

type GeminiHistoryResult = {
  messages: AnyRecord[];
  tokenUsage?: unknown;
};

function mapGeminiRole(value: unknown): 'user' | 'assistant' | null {
  if (value === 'user') {
    return 'user';
  }

  if (value === 'gemini' || value === 'assistant') {
    return 'assistant';
  }

  return null;
}

function extractGeminiTextContent(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }

  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .map((part) => {
      if (typeof part === 'string') {
        return part;
      }
      if (!part || typeof part !== 'object') {
        return '';
      }

      const record = part as AnyRecord;
      if (typeof record.text === 'string') {
        return record.text;
      }

      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function extractGeminiThoughts(thoughts: unknown): string {
  if (!Array.isArray(thoughts)) {
    return '';
  }

  return thoughts
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return '';
      }

      const record = item as AnyRecord;
      const subject = typeof record.subject === 'string' ? record.subject.trim() : '';
      const description = typeof record.description === 'string' ? record.description.trim() : '';

      if (subject && description) {
        return `${subject}: ${description}`;
      }

      return description || subject;
    })
    .filter(Boolean)
    .join('\n');
}

function buildGeminiTokenUsage(tokens: unknown): AnyRecord | undefined {
  if (!tokens || typeof tokens !== 'object') {
    return undefined;
  }

  const record = tokens as AnyRecord;
  const input = Number(record.input || 0);
  const output = Number(record.output || 0);
  const cached = Number(record.cached || 0);
  const thoughts = Number(record.thoughts || 0);
  const tool = Number(record.tool || 0);

  const totalFromFields = input + output + cached + thoughts + tool;
  const total = Number(record.total || totalFromFields || 0);

  return {
    used: total,
    total: total,
    breakdown: {
      input,
      output,
      cached,
      thoughts,
      tool,
    },
  };
}

async function getGeminiLegacySessionMessages(sessionFilePath: string): Promise<GeminiHistoryResult> {
  try {
    const data = await fs.readFile(sessionFilePath, 'utf8');
    const session = JSON.parse(data) as AnyRecord;
    const sourceMessages = Array.isArray(session.messages) ? session.messages : [];

    const messages: AnyRecord[] = [];
    for (const msg of sourceMessages) {
      const role = mapGeminiRole(msg.type ?? msg.role);
      if (!role) {
        continue;
      }

      messages.push({
        type: 'message',
        uuid: typeof msg.id === 'string' ? msg.id : undefined,
        message: { role, content: msg.content },
        timestamp: msg.timestamp || null,
      });
    }

    return { messages };
  } catch {
    return { messages: [] };
  }
}

async function getGeminiJsonlSessionMessages(sessionFilePath: string): Promise<GeminiHistoryResult> {
  const messages: AnyRecord[] = [];
  let tokenUsage: AnyRecord | undefined;

  try {
    const fileStream = fsSync.createReadStream(sessionFilePath);
    const lineReader = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    for await (const line of lineReader) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      let entry: AnyRecord;
      try {
        entry = JSON.parse(trimmed) as AnyRecord;
      } catch {
        continue;
      }

      // Metadata/update lines (e.g. {$set:{lastUpdated:...}}) do not represent chat messages.
      if (entry.$set) {
        continue;
      }

      const role = mapGeminiRole(entry.type);
      if (role) {
        const textContent = extractGeminiTextContent(entry.content);
        if (textContent.trim()) {
          messages.push({
            type: 'message',
            uuid: typeof entry.id === 'string' ? entry.id : undefined,
            message: { role, content: textContent },
            timestamp: entry.timestamp || null,
          });
        }

        const thinkingContent = extractGeminiThoughts(entry.thoughts);
        if (thinkingContent.trim()) {
          messages.push({
            type: 'thinking',
            uuid: typeof entry.id === 'string' ? `${entry.id}_thinking` : undefined,
            message: { role: 'assistant', content: thinkingContent },
            timestamp: entry.timestamp || null,
            isReasoning: true,
          });
        }

        if (role === 'assistant') {
          const usage = buildGeminiTokenUsage(entry.tokens);
          if (usage) {
            tokenUsage = usage;
          }
        }

        continue;
      }

      if (entry.type === 'tool_use') {
        messages.push({
          type: 'tool_use',
          uuid: typeof entry.id === 'string' ? entry.id : undefined,
          timestamp: entry.timestamp || null,
          toolName: entry.tool_name || entry.name || 'Tool',
          toolInput: entry.parameters ?? entry.input ?? entry.arguments ?? '',
          toolCallId: entry.tool_id || entry.toolCallId || entry.id,
        });
        continue;
      }

      if (entry.type === 'tool_result') {
        messages.push({
          type: 'tool_result',
          uuid: typeof entry.id === 'string' ? entry.id : undefined,
          timestamp: entry.timestamp || null,
          toolCallId: entry.tool_id || entry.toolCallId || entry.id || '',
          output: entry.output ?? entry.result ?? '',
          isError: Boolean(entry.error) || entry.status === 'error',
        });
      }
    }
  } catch {
    return { messages: [] };
  }

  messages.sort(
    (a, b) => new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime(),
  );

  return { messages, tokenUsage };
}

async function getGeminiCliSessionMessages(sessionId: string): Promise<GeminiHistoryResult> {
  const sessionFilePath = sessionsDb.getSessionById(sessionId)?.jsonl_path;
  if (!sessionFilePath) {
    return { messages: [] };
  }

  if (sessionFilePath.endsWith('.jsonl')) {
    return getGeminiJsonlSessionMessages(sessionFilePath);
  }

  return getGeminiLegacySessionMessages(sessionFilePath);
}

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
   * Loads Gemini history from Gemini CLI session files on disk.
   */
  async fetchHistory(
    sessionId: string,
    options: FetchHistoryOptions = {},
  ): Promise<FetchHistoryResult> {
    const { limit = null, offset = 0 } = options;

    let result: GeminiHistoryResult;
    try {
      result = await getGeminiCliSessionMessages(sessionId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[GeminiProvider] Failed to load session ${sessionId}:`, message);
      return { messages: [], total: 0, hasMore: false, offset: 0, limit: null };
    }

    const rawMessages = result.messages;
    const normalized: NormalizedMessage[] = [];

    for (let i = 0; i < rawMessages.length; i++) {
      const raw = rawMessages[i];
      const ts = raw.timestamp || new Date().toISOString();
      const baseId = raw.uuid || generateMessageId('gemini');

      if (raw.type === 'thinking' || raw.isReasoning) {
        const thinkingContent = typeof raw.message?.content === 'string'
          ? raw.message.content
          : typeof raw.content === 'string'
            ? raw.content
            : '';

        if (thinkingContent.trim()) {
          normalized.push(createNormalizedMessage({
            id: baseId,
            sessionId,
            timestamp: ts,
            provider: PROVIDER,
            kind: 'thinking',
            content: thinkingContent,
          }));
        }
        continue;
      }

      if (raw.type === 'tool_use' || raw.toolName) {
        normalized.push(createNormalizedMessage({
          id: baseId,
          sessionId,
          timestamp: ts,
          provider: PROVIDER,
          kind: 'tool_use',
          toolName: raw.toolName || 'Tool',
          toolInput: raw.toolInput,
          toolId: raw.toolCallId || baseId,
        }));
        continue;
      }

      if (raw.type === 'tool_result') {
        normalized.push(createNormalizedMessage({
          id: baseId,
          sessionId,
          timestamp: ts,
          provider: PROVIDER,
          kind: 'tool_result',
          toolId: raw.toolCallId || '',
          content: raw.output === undefined ? '' : String(raw.output),
          isError: Boolean(raw.isError),
        }));
        continue;
      }

      const role = raw.message?.role || raw.role;
      const content = raw.message?.content || raw.content;
      if (!role || !content) {
        continue;
      }

      const normalizedRole = role === 'user' ? 'user' : 'assistant';

      if (Array.isArray(content)) {
        for (let partIdx = 0; partIdx < content.length; partIdx++) {
          const part = content[partIdx] as AnyRecord | string;

          if (typeof part === 'string' && part.trim()) {
            normalized.push(createNormalizedMessage({
              id: `${baseId}_${partIdx}`,
              sessionId,
              timestamp: ts,
              provider: PROVIDER,
              kind: 'text',
              role: normalizedRole,
              content: part,
            }));
            continue;
          }

          if (!part || typeof part !== 'object') {
            continue;
          }

          if ((part.type === 'text' || !part.type) && typeof part.text === 'string' && part.text.trim()) {
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
      } else {
        const textContent = extractGeminiTextContent(content);
        if (textContent.trim()) {
          normalized.push(createNormalizedMessage({
            id: baseId,
            sessionId,
            timestamp: ts,
            provider: PROVIDER,
            kind: 'text',
            role: normalizedRole,
            content: textContent,
          }));
        }
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
      tokenUsage: result.tokenUsage,
    };
  }
}
