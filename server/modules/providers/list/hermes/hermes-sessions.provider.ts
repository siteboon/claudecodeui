import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';

import { sessionsDb } from '@/modules/database/index.js';
import type { IProviderSessions } from '@/shared/interfaces.js';
import type { AnyRecord, FetchHistoryOptions, FetchHistoryResult, NormalizedMessage } from '@/shared/types.js';
import {
  createNormalizedMessage,
  generateMessageId,
  normalizeProviderTimestamp,
  readObjectRecord,
  readOptionalString,
  sliceTailPage,
} from '@/shared/utils.js';

const PROVIDER = 'hermes';
const HERMES_DB_PATH = path.join(os.homedir(), '.hermes', 'state.db');

type HermesMessageRow = {
  id: number;
  role: string;
  content: string | null;
  tool_call_id: string | null;
  tool_calls: string | null;
  tool_name: string | null;
  timestamp: number;
  reasoning: string | null;
  reasoning_content: string | null;
  finish_reason: string | null;
};

function formatContent(value: unknown): string {
  if (value === undefined || value === null) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function readUpdateType(raw: AnyRecord): string {
  return readOptionalString(raw.type)
    ?? readOptionalString(raw.kind)
    ?? readOptionalString(raw.sessionUpdate)
    ?? readOptionalString(raw.session_update)
    ?? readOptionalString(raw.update)
    ?? readOptionalString(raw.event)
    ?? '';
}

function readEventSessionId(raw: AnyRecord, sessionId: string | null): string | null {
  return readOptionalString(raw.sessionId) ?? readOptionalString(raw.session_id) ?? sessionId;
}

function normalizeHermesEvent(rawMessage: unknown, sessionId: string | null, history = false): NormalizedMessage[] {
  const envelope = readObjectRecord(rawMessage);
  if (!envelope) {
    return [];
  }

  const nestedUpdate = readObjectRecord(envelope.update);
  const raw = nestedUpdate ? { ...nestedUpdate, sessionId: envelope.sessionId ?? envelope.session_id ?? sessionId } : envelope;

  const type = readUpdateType(raw);
  const eventSessionId = readEventSessionId(raw, sessionId);
  const timestamp = normalizeProviderTimestamp(raw.timestamp ?? raw.time ?? raw.createdAt ?? raw.created_at);
  const baseId = readOptionalString(raw.id) ?? readOptionalString(raw.messageId) ?? readOptionalString(raw.message_id) ?? generateMessageId(PROVIDER);

  if (['agent_message_chunk', 'assistant_message_chunk', 'message_delta', 'text_delta', 'text'].includes(type)) {
    const content = readOptionalString(raw.content)
      ?? readOptionalString(raw.text)
      ?? readOptionalString(raw.delta)
      ?? readOptionalString(readObjectRecord(raw.message)?.content)
      ?? '';
    if (!content.trim()) {
      return [];
    }
    return [createNormalizedMessage({
      id: baseId,
      sessionId: eventSessionId,
      timestamp,
      provider: PROVIDER,
      kind: history ? 'text' : 'stream_delta',
      role: history ? 'assistant' : undefined,
      content,
    })];
  }

  if (['agent_message', 'assistant_message', 'message'].includes(type)) {
    const role = readOptionalString(raw.role) === 'user' ? 'user' : 'assistant';
    const content = readOptionalString(raw.content)
      ?? readOptionalString(raw.text)
      ?? readOptionalString(readObjectRecord(raw.message)?.content)
      ?? '';
    if (!content.trim()) {
      return [];
    }
    return [createNormalizedMessage({
      id: baseId,
      sessionId: eventSessionId,
      timestamp,
      provider: PROVIDER,
      kind: history ? 'text' : role === 'assistant' ? 'stream_delta' : 'text',
      role: history || role === 'user' ? role : undefined,
      content,
    })];
  }

  if (['agent_thought_chunk', 'thought_delta', 'thinking', 'reasoning'].includes(type)) {
    const content = readOptionalString(raw.content) ?? readOptionalString(raw.text) ?? readOptionalString(raw.delta) ?? '';
    if (!content.trim()) {
      return [];
    }
    return [createNormalizedMessage({
      id: baseId,
      sessionId: eventSessionId,
      timestamp,
      provider: PROVIDER,
      kind: 'thinking',
      content,
    })];
  }

  if (['tool_call', 'tool_use', 'tool_call_start'].includes(type)) {
    const tool = readObjectRecord(raw.tool);
    const toolId = readOptionalString(raw.toolCallId) ?? readOptionalString(raw.tool_call_id) ?? readOptionalString(raw.toolId) ?? baseId;
    return [createNormalizedMessage({
      id: baseId,
      sessionId: eventSessionId,
      timestamp,
      provider: PROVIDER,
      kind: 'tool_use',
      toolName: readOptionalString(raw.toolName)
        ?? readOptionalString(raw.tool_name)
        ?? readOptionalString(raw.title)
        ?? readOptionalString(raw.name)
        ?? readOptionalString(tool?.name)
        ?? 'Tool',
      toolInput: raw.rawInput ?? raw.raw_input ?? raw.input ?? raw.arguments ?? raw.params ?? tool?.input ?? {},
      toolId,
    })];
  }

  if (['tool_call_update', 'tool_result', 'tool_call_result', 'tool_call_done'].includes(type)) {
    return [createNormalizedMessage({
      id: baseId,
      sessionId: eventSessionId,
      timestamp,
      provider: PROVIDER,
      kind: 'tool_result',
      toolId: readOptionalString(raw.toolCallId) ?? readOptionalString(raw.tool_call_id) ?? readOptionalString(raw.toolId) ?? '',
      content: formatContent(raw.output ?? raw.result ?? raw.content ?? raw.delta ?? ''),
      isError: Boolean(raw.error) || raw.status === 'error',
    })];
  }

  if (type === 'plan') {
    const content = readOptionalString(raw.content) ?? readOptionalString(raw.text) ?? formatContent(raw.plan);
    if (!content.trim()) {
      return [];
    }
    return [createNormalizedMessage({
      id: baseId,
      sessionId: eventSessionId,
      timestamp,
      provider: PROVIDER,
      kind: 'status',
      text: 'plan',
      summary: content,
    })];
  }

  if (type === 'error') {
    return [createNormalizedMessage({
      id: baseId,
      sessionId: eventSessionId,
      timestamp,
      provider: PROVIDER,
      kind: 'error',
      content: readOptionalString(raw.error) ?? readOptionalString(raw.message) ?? 'Unknown Hermes error',
    })];
  }

  return [];
}

function parseJsonArray(value: string | null): unknown[] {
  if (!value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function readHermesHistoryFromDatabase(sessionId: string): NormalizedMessage[] {
  const normalized: NormalizedMessage[] = [];
  if (!fsSync.existsSync(HERMES_DB_PATH)) {
    return normalized;
  }

  const db = new Database(HERMES_DB_PATH, { readonly: true, fileMustExist: true });
  try {
    const rows = db.prepare(`
      SELECT id, role, content, tool_call_id, tool_calls, tool_name, timestamp, reasoning, reasoning_content, finish_reason
      FROM messages
      WHERE session_id = ? AND active = 1
      ORDER BY timestamp ASC, id ASC
    `).all(sessionId) as HermesMessageRow[];

    for (const row of rows) {
      const timestamp = new Date(row.timestamp * 1000).toISOString();
      const baseId = `hermes-${sessionId}-${row.id}`;

      const reasoning = row.reasoning_content || row.reasoning;
      if (reasoning?.trim()) {
        normalized.push(createNormalizedMessage({
          id: `${baseId}-thinking`,
          sessionId,
          timestamp,
          provider: PROVIDER,
          kind: 'thinking',
          content: reasoning,
        }));
      }

      for (const toolCall of parseJsonArray(row.tool_calls)) {
        const call = readObjectRecord(toolCall);
        const fn = readObjectRecord(call?.function);
        normalized.push(createNormalizedMessage({
          id: `${baseId}-tool-${readOptionalString(call?.id) ?? normalized.length}`,
          sessionId,
          timestamp,
          provider: PROVIDER,
          kind: 'tool_use',
          toolName: readOptionalString(fn?.name) ?? readOptionalString(call?.name) ?? 'Tool',
          toolInput: fn?.arguments ?? call?.arguments ?? {},
          toolId: readOptionalString(call?.id) ?? `${baseId}-tool`,
        }));
      }

      if (row.role === 'tool') {
        normalized.push(createNormalizedMessage({
          id: `${baseId}-result`,
          sessionId,
          timestamp,
          provider: PROVIDER,
          kind: 'tool_result',
          toolId: row.tool_call_id ?? '',
          content: row.content ?? '',
          isError: row.finish_reason === 'error',
        }));
        continue;
      }

      if (row.content?.trim()) {
        normalized.push(createNormalizedMessage({
          id: baseId,
          sessionId,
          timestamp,
          provider: PROVIDER,
          kind: 'text',
          role: row.role === 'user' ? 'user' : 'assistant',
          content: row.content,
        }));
      }
    }
  } finally {
    db.close();
  }

  return normalized;
}

export class HermesSessionsProvider implements IProviderSessions {
  normalizeMessage(rawMessage: unknown, sessionId: string | null): NormalizedMessage[] {
    return normalizeHermesEvent(rawMessage, sessionId);
  }

  async fetchHistory(sessionId: string, options: FetchHistoryOptions = {}): Promise<FetchHistoryResult> {
    const { limit = null, offset = 0 } = options;
    const row = sessionsDb.getSessionById(sessionId) ?? sessionsDb.getSessionByProviderSessionId(sessionId);
    const messages = readHermesHistoryFromDatabase(row?.provider_session_id ?? sessionId);

    const start = Math.max(0, offset);
    const pageLimit = limit === null ? null : Math.max(0, limit);
    const page = sliceTailPage(messages, pageLimit, start);
    return {
      messages: page.page,
      total: messages.length,
      hasMore: page.hasMore,
      offset: start,
      limit: pageLimit,
    };
  }
}
