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

  // The last row is always on the active branch. Walk parent pointers from it
  // to the root, preferring later siblings at each level.
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

  const branchRows = rows.filter((row) => {
    if (!row.id) {
      // Header and other non-message rows are included only when they carry a
      // role-bearing message (they should not); keep non-id rows out of the
      // transcript except the header is skipped by the caller via type checks.
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

  // Extract text content from either a plain string or an array of content parts.
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
          if (typeof record.text === 'string') {
            return record.text;
          }
          if (record.type === 'text' && typeof record.text === 'string') {
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

  if (role === 'user') {
    if (!content) {
      return [];
    }
    return [createNormalizedMessage({
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
    })];
  }

  if (role === 'assistant') {
    if (!content) {
      return [];
    }
    return [createNormalizedMessage({
      id: `${rowId}_assistant`,
      sessionId,
      timestamp,
      provider: PROVIDER,
      kind: 'text',
      role: 'assistant',
      content,
      transcriptAnchorId: rowId,
    })];
  }

  return [];
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
