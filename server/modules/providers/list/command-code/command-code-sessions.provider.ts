import fsSync from 'node:fs';
import readline from 'node:readline';

import { sessionsDb } from '@/modules/database/index.js';
import type { IProviderSessions } from '@/shared/interfaces.js';
import { prepareTranscriptMessages } from '@/shared/message-unification.js';
import type {
  AnyRecord,
  FetchHistoryOptions,
  FetchHistoryResult,
  NormalizedMessage,
} from '@/shared/types.js';
import {
  createNormalizedMessage,
  generateMessageId,
  readObjectRecord,
  sliceTailPage,
} from '@/shared/utils.js';

const PROVIDER = 'command-code';

/**
 * Reads a Command Code JSONL transcript and returns the active branch as a
 * linear, oldest-first list of message rows.
 *
 * Command Code transcripts are a flat append-only list: one header row
 * (`{"type":"session","id":...,"cwd":...}`) followed by `{"type":"message",
 * "id":...,"parentId":...,"message":{role,content,model,usage,...}}` rows that
 * form a tree. There is no per-row session id and no rewind marker, so the
 * conversation shown is the active branch: the longest chain following
 * `parentId` from the last row, preferring later siblings. This deliberately
 * does NOT graph-prune older prompts (Claude-style) nor stack every fork
 * (codex-style) — it linearizes only the live path.
 */
const readTranscriptRows = async (jsonlPath: string): Promise<AnyRecord[]> => {
  const rows: AnyRecord[] = [];
  const stream = fsSync.createReadStream(jsonlPath);
  const lineReader = readline.createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of lineReader) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    try {
      rows.push(JSON.parse(trimmed) as AnyRecord);
    } catch {
      // Skip malformed lines that can appear during concurrent writes.
    }
  }

  if (rows.length === 0) {
    return [];
  }

  const rowsById = new Map<string, AnyRecord>();
  for (const row of rows) {
    if (typeof row.id === 'string') {
      rowsById.set(row.id, row);
    }
  }

  // Walk direct parent pointers from the last row up to the root. The last
  // row is always part of the active conversation, so following its parentId
  // chain recovers the live path without stacking every fork.
  const activeBranch = new Set<string>();
  let cursor: AnyRecord | null = rows[rows.length - 1];
  const visited = new Set<string>();

  while (cursor && !visited.has(String(cursor.id ?? ''))) {
    const cursorId = String(cursor.id ?? '');
    if (!cursorId) {
      break;
    }
    visited.add(cursorId);
    activeBranch.add(cursorId);

    const parentId: string | undefined = typeof cursor.parentId === 'string'
      ? cursor.parentId
      : undefined;
    cursor = parentId ? (rowsById.get(parentId) ?? null) : null;
  }

  // Count the message rows actually reachable via the parent chain. When the
  // chain is incomplete or shorter than the full set of message rows (e.g. a
  // transcript whose pointers do not form one connected path), fall back to
  // every message row in file order so history is never dropped.
  const messageRows = rows.filter((row) => row.type === 'message');
  const reachableMessageRows = messageRows.filter((row) => {
    const rowId = String(row.id ?? '');
    return rowId && activeBranch.has(rowId);
  });

  // The parent walk normally reaches every message row on the live path; only
  // when it misses some (a gap in the chain) do we fall back to all messages.
  const branchRows = reachableMessageRows.length < messageRows.length
    ? messageRows
    : rows.filter((row) => {
        if (!row.id) {
          // Header and other non-message rows are not transcript entries.
          return false;
        }
        return activeBranch.has(String(row.id));
      });

  // Keep chronological order (rows were appended oldest-first).
  return branchRows;
};

/**
 * Normalizes a Command Code transcript/event row into the shared message shape.
 *
 * Rows carry a `message` object with a `role`; user rows become user text,
 * assistant rows become assistant text, and tool-shaped rows are normalized
 * from the message content array. Rows without a role (headers, lifecycle
 * rows) produce nothing.
 */
const normalizeCommandCodeRow = (raw: AnyRecord, sessionId: string | null): NormalizedMessage[] => {
  const message = readObjectRecord(raw.message);
  if (!message) {
    return [];
  }

  const timestamp = typeof raw.timestamp === 'string'
    ? raw.timestamp
    : new Date().toISOString();
  const rowId = typeof raw.id === 'string'
    ? raw.id
    : generateMessageId('command-code');

  // Extract text content from either a plain string or an array of content
  // parts. Only `text` parts contribute to the prose so persisted tool parts
  // (handled separately below) never leak their payloads into the message text.
  const readContent = (): string => {
    if (typeof message.content === 'string') {
      return message.content;
    }
    if (Array.isArray(message.content)) {
      return message.content
        .map((part: unknown) => {
          if (typeof part === 'string') {
            return part;
          }
          const record = readObjectRecord(part);
          if (!record) {
            return '';
          }
          const partType = typeof record.type === 'string' ? record.type : '';
          if (partType === 'text' && typeof record.text === 'string') {
            return record.text;
          }
          if (partType === '' && typeof record.text === 'string') {
            return record.text;
          }
          return '';
        })
        .filter(Boolean)
        .join('\n');
    }
    return '';
  };

  const role = message.role === 'user' ? 'user' : message.role === 'assistant' ? 'assistant' : undefined;

  const content = readContent().trim();
  const normalized: NormalizedMessage[] = [];

  // Persisted tool activity: a message content array can carry `tool_use`
  // and `tool_result` parts (Command Code records tool calls inline). Emit
  // each as its own normalized message so fetchHistory's toolResultMap pairing
  // can restore tool results after a reload instead of dropping them.
  if (Array.isArray(message.content)) {
    for (const part of message.content) {
      const record = readObjectRecord(part);
      if (!record) {
        continue;
      }
      const partType = typeof record.type === 'string' ? record.type : '';
      if (partType === 'tool_use' || partType === 'toolUse') {
        const toolId = typeof record.id === 'string'
          ? record.id
          : typeof record.toolCallId === 'string' ? record.toolCallId : `${rowId}_tool`;
        normalized.push(createNormalizedMessage({
          id: `${rowId}_${toolId}`,
          sessionId,
          timestamp,
          provider: PROVIDER,
          kind: 'tool_use',
          toolName: typeof record.name === 'string' ? record.name : 'Unknown',
          toolInput: record.input ?? record.arguments ?? {},
          toolId,
          transcriptAnchorId: rowId,
        }));
      } else if (partType === 'tool_result' || partType === 'toolResult') {
        const toolId = typeof record.toolCallId === 'string'
          ? record.toolCallId
          : typeof record.id === 'string' ? record.id : `${rowId}_tool`;
        normalized.push(createNormalizedMessage({
          id: `${rowId}_${toolId}_result`,
          sessionId,
          timestamp,
          provider: PROVIDER,
          kind: 'tool_result',
          toolId,
          content: typeof record.content === 'string'
            ? record.content
            : typeof record.output === 'string' ? record.output : '',
          isError: Boolean(record.isError),
          transcriptAnchorId: rowId,
        }));
      }
    }
  }

  if (role === 'user') {
    if (content) {
      normalized.push(createNormalizedMessage({
        id: `${rowId}_user`,
        sessionId,
        timestamp,
        provider: PROVIDER,
        kind: 'text',
        role: 'user',
        content,
        // Stable row identity for future edit/fork anchors (Command Code rows
        // carry stable ids).
        transcriptAnchorId: rowId,
      }));
    }
    return normalized;
  }

  if (role === 'assistant') {
    if (content) {
      normalized.push(createNormalizedMessage({
        id: `${rowId}_assistant`,
        sessionId,
        timestamp,
        provider: PROVIDER,
        kind: 'text',
        role: 'assistant',
        content,
        transcriptAnchorId: rowId,
      }));
    }
    return normalized;
  }

  return normalized;
};

export class CommandCodeSessionsProvider implements IProviderSessions {
  /**
   * Normalizes a raw live NDJSON event frame or a history row.
   *
   * History rows carry a `message.role` and are normalized directly. Live
   * `command-code -p --output-format json` events come in two shapes: event
   * frames (`{"type":"event","event":{...AgentEvent...}}`) and one final
   * result line (`{"type":"result",...}`). Result lines are handled by the
   * runtime (terminal + token usage); event frames that carry text/tool
   * content are normalized here.
   */
  normalizeMessage(rawMessage: unknown, sessionId: string | null): NormalizedMessage[] {
    const raw = readObjectRecord(rawMessage);
    if (!raw) {
      return [];
    }

    // A transcript row with a role-bearing message.
    if (readObjectRecord(raw.message)?.role) {
      return normalizeCommandCodeRow(raw, sessionId);
    }

    // Live NDJSON wrapper: {"type":"event","event":{...}}.
    if (raw.type === 'event') {
      const event = readObjectRecord(raw.event);
      if (!event) {
        return [];
      }

      const eventType = typeof event.type === 'string' ? event.type : '';
      const timestamp = typeof event.timestamp === 'string'
        ? event.timestamp
        : new Date().toISOString();
      const eventId = typeof event.id === 'string'
        ? event.id
        : generateMessageId('command-code-event');

      // Stream deltas: the event body may carry text under `content`/`text`.
      if (eventType === 'stream_event' || eventType === 'text' || eventType === 'content') {
        const text = typeof event.content === 'string'
          ? event.content
          : typeof event.text === 'string' ? event.text : '';
        if (text) {
          return [createNormalizedMessage({
            id: eventId,
            sessionId,
            timestamp,
            provider: PROVIDER,
            kind: 'stream_delta',
            content: text,
          })];
        }
      }

      if (eventType === 'tool_running' || eventType === 'tool_use') {
        const toolName = typeof event.toolName === 'string'
          ? event.toolName
          : (typeof event.name === 'string' ? event.name : 'Unknown');
        const toolId = typeof event.toolCallId === 'string'
          ? event.toolCallId
          : (typeof event.id === 'string' ? event.id : eventId);
        const toolInput = event.input ?? event.arguments ?? {};
        return [createNormalizedMessage({
          id: eventId,
          sessionId,
          timestamp,
          provider: PROVIDER,
          kind: 'tool_use',
          toolName,
          toolInput,
          toolId,
        })];
      }

      // Unknown/forward-compatible event types are ignored.
      return [];
    }

    // A raw event with a direct `type` (not wrapped).
    if (raw.type === 'result') {
      // Result frames are terminal; the runtime owns their handling.
      return [];
    }

    return normalizeCommandCodeRow(raw, sessionId);
  }

  /**
   * Loads a Command Code session's history from its transcript file.
   */
  async fetchHistory(
    sessionId: string,
    options: FetchHistoryOptions = {},
  ): Promise<FetchHistoryResult> {
    const { limit = null, offset = 0 } = options;

    let transcriptPath: string | null = null;
    try {
      transcriptPath = sessionsDb.getSessionById(sessionId)?.jsonl_path ?? null;
      if (!transcriptPath) {
        return { messages: [], total: 0, hasMore: false, offset: 0, limit: null };
      }
    } catch {
      return { messages: [], total: 0, hasMore: false, offset: 0, limit: null };
    }

    let normalized: NormalizedMessage[] = [];
    try {
      const rows = await readTranscriptRows(transcriptPath);
      for (const row of rows) {
        if (row.type !== 'message') {
          continue;
        }
        normalized.push(...normalizeCommandCodeRow(row, sessionId));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[CommandCodeProvider] Failed to load session ${sessionId}:`, message);
      return { messages: [], total: 0, hasMore: false, offset: 0, limit: null };
    }

    // Pair tool_results with their tool_use so the transcript renders one row.
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

    const transcript = prepareTranscriptMessages(normalized);
    const total = transcript.length;
    const normalizedOffset = Math.max(0, offset);
    const normalizedLimit = limit === null ? null : Math.max(0, limit);
    const { page, hasMore } = sliceTailPage(transcript, normalizedLimit, normalizedOffset);

    return {
      messages: page,
      total,
      hasMore,
      offset: normalizedOffset,
      limit: normalizedLimit,
    };
  }
}
