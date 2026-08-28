import fsSync from 'node:fs';

import Database from 'better-sqlite3';

import type { IProviderSessions } from '@/shared/interfaces.js';
import type { AnyRecord, FetchHistoryOptions, FetchHistoryResult, NormalizedMessage } from '@/shared/types.js';
import {
  createNormalizedMessage,
  generateMessageId,
  getZCodeDatabasePath,
  normalizeProviderTimestamp,
  readJsonRecord,
  readObjectRecord,
  readOptionalString,
  sliceTailPage,
} from '@/shared/utils.js';

const PROVIDER = 'zcode';

/**
 * Open a read-only connection to ZCode's SQLite database.
 * Returns null if the database doesn't exist.
 */
function openZCodeDatabase(): Database.Database | null {
  const dbPath = getZCodeDatabasePath();
  if (!fsSync.existsSync(dbPath)) {
    return null;
  }

  try {
    return new Database(dbPath, { readonly: true, fileMustExist: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn('[ZCodeProvider] Failed to open database:', message);
    return null;
  }
}

type ZCodeHistoryRow = {
  message_id: string;
  message_time_created: number | null;
  message_sequence: number | null;
  message_data: string | null;
  part_id: string | null;
  part_time_created: number | null;
  part_data: string | null;
};

/**
 * Token usage totals in ZCode's internal vocabulary.
 */
type ZCodeTokenTotals = {
  input: number;
  output: number;
  reasoning: number;
  cache: number;
};

/**
 * Reads token usage from either the streaming shape
 * (`{inputTokens, outputTokens, reasoningTokens, cacheReadTokens, cacheWriteTokens}`)
 * or the SQLite `message.data.tokens` shape
 * (`{input, output, reasoning, cache: {read, write}}`).
 * Returns null when no positive count is present in either shape.
 */
function readTokenTotals(value: unknown): ZCodeTokenTotals | null {
  const record = readObjectRecord(value);
  if (!record) {
    return null;
  }

  const cacheRecord = readObjectRecord(record.cache);
  const totals: ZCodeTokenTotals = {
    input: Number(record.inputTokens ?? record.input ?? 0),
    output: Number(record.outputTokens ?? record.output ?? 0),
    reasoning: Number(record.reasoningTokens ?? record.reasoning ?? 0),
    cache: cacheRecord
      ? Number(cacheRecord.read ?? 0) + Number(cacheRecord.write ?? 0)
      : Number(record.cacheReadTokens ?? 0) + Number(record.cacheWriteTokens ?? 0),
  };

  const used = totals.input + totals.output + totals.reasoning + totals.cache;
  return used > 0 ? totals : null;
}

/**
 * Reads the total used-token count from either the streaming usage shape
 * (`{inputTokens, outputTokens, reasoningTokens, cacheReadTokens, cacheWriteTokens}`)
 * or the SQLite `message.data.tokens` shape
 * (`{input, output, reasoning, cache: {read, write}}`).
 * Returns undefined when no positive count is present.
 */
function readTokenUsedCount(value: unknown): number | undefined {
  const totals = readTokenTotals(value);
  if (!totals) {
    return undefined;
  }
  return totals.input + totals.output + totals.reasoning + totals.cache;
}

/**
 * Builds the shared token usage summary from ZCode token totals.
 * Shape matches the `token_budget` summaries other providers report
 * (`used` plus input/output breakdown).
 */
function buildTokenUsage(totals: ZCodeTokenTotals | null): AnyRecord | undefined {
  if (!totals) {
    return undefined;
  }

  return {
    used: totals.input + totals.output + totals.reasoning + totals.cache,
    inputTokens: totals.input,
    outputTokens: totals.output,
    breakdown: {
      input: totals.input,
      output: totals.output,
    },
  };
}

/**
 * Extract and format tool call content for display.
 */
function formatToolContent(value: unknown): string {
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

/**
 * Extract text content from a part or message structure.
 */
function extractText(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  const record = readObjectRecord(value);
  return readOptionalString(record?.text)
    ?? readOptionalString(record?.content)
    ?? readOptionalString(record?.delta)
    ?? '';
}

/**
 * Aggregate token usage from all messages in a session.
 */
function aggregateZCodeSessionTokenUsage(
  db: Database.Database,
  sessionId: string,
): AnyRecord | undefined {
  const rows = db.prepare('SELECT data FROM message WHERE session_id = ?').all(sessionId) as { data: string }[];

  const totals: ZCodeTokenTotals = { input: 0, output: 0, reasoning: 0, cache: 0 };
  let hasAnyUsage = false;

  for (const row of rows) {
    const info = readJsonRecord(row.data);
    const messageTotals = readTokenTotals(info?.tokens);
    if (!messageTotals) {
      continue;
    }

    hasAnyUsage = true;
    totals.input += messageTotals.input;
    totals.output += messageTotals.output;
    totals.reasoning += messageTotals.reasoning;
    totals.cache += messageTotals.cache;
  }

  return hasAnyUsage ? buildTokenUsage(totals) : undefined;
}

/**
 * Session history provider for ZCode's SQLite-backed session store.
 *
 * Implements the IProviderSessions interface to normalize ZCode-specific
 * events and message history into the shared transport shapes consumed by
 * API routes and realtime streams.
 */
export class ZCodeSessionsProvider implements IProviderSessions {
  /**
   * Normalizes live protocol events into frontend messages.
   *
   * Consumes the event shapes documented in Phase 0.3: typed envelopes such
   * as `{type: "model_streaming", payload: {kind, delta}}`,
   * `{type: "tool_call_scheduled", payload: {toolCallId, toolName, input}}`,
   * and `{type: "turn_complete", payload: {usage}}`. The `session/event`
   * notification wrapper (`{event}` or `{data}` around the typed payload) is
   * unwrapped first. Boundary marker kinds (`*_start`/`*_end` with empty
   * deltas) and unknown types produce no messages.
   */
  normalizeMessage(rawMessage: unknown, sessionId: string | null): NormalizedMessage[] {
    const raw = readObjectRecord(rawMessage);
    if (!raw) {
      return [];
    }

    // Unwrap the session/event notification payload: the typed event may sit
    // behind `params` (full notification envelope) and then an `event`/`data`
    // wrapper (both seen in spike transcripts). Peels up to three layers or
    // until a `type` discriminator appears.
    let event: AnyRecord = raw;
    for (let depth = 0; depth < 3 && !readOptionalString(event.type); depth += 1) {
      const next = readObjectRecord(event.event)
        ?? readObjectRecord(event.data)
        ?? readObjectRecord(event.params);
      if (!next) {
        break;
      }
      event = next;
    }
    const type = readOptionalString(event.type) ?? readOptionalString(event.event);
    if (!type) {
      return [];
    }

    const payload = readObjectRecord(event.payload) ?? {};
    const eventSessionId = readOptionalString(event.sessionId)
      ?? readOptionalString(raw.sessionId)
      ?? sessionId;
    const timestamp = normalizeProviderTimestamp(event.time ?? event.timestamp);
    const baseId = readOptionalString(event.id)
      ?? readOptionalString(event.messageID)
      ?? readOptionalString(payload.messageId)
      ?? generateMessageId('zcode');

    if (type === 'model_streaming') {
      return this.normalizeStreamingKind(payload, eventSessionId, timestamp, baseId);
    }

    // Tool calls surface as their own event type before execution
    if (type === 'tool_call_scheduled') {
      const toolName = readOptionalString(payload.toolName) ?? 'Tool';
      const toolId = readOptionalString(payload.toolCallId) ?? baseId;
      return [createNormalizedMessage({
        id: baseId,
        sessionId: eventSessionId,
        timestamp,
        provider: PROVIDER,
        kind: 'tool_use',
        toolName,
        toolInput: payload.input ?? {},
        toolId,
      })];
    }

    // Run completion: both the per-model-call and the terminal turn event
    // carry usage; the runtime collapses them into exactly one complete.
    if (type === 'model_complete' || type === 'turn_complete') {
      return [createNormalizedMessage({
        id: baseId,
        sessionId: eventSessionId,
        timestamp,
        provider: PROVIDER,
        kind: 'complete',
        tokens: readTokenUsedCount(payload.usage),
      })];
    }

    if (type === 'permission_request' || type === 'approval') {
      return [createNormalizedMessage({
        id: baseId,
        sessionId: eventSessionId,
        timestamp,
        provider: PROVIDER,
        kind: 'permission_request',
        toolName: readOptionalString(payload.tool) ?? readOptionalString(payload.toolName) ?? readOptionalString(payload.action),
        canInterrupt: true,
      })];
    }

    if (type === 'error' || type === 'fatal' || type === 'turn.failed') {
      // `turn.failed` (observed live on engine 0.16.3) wraps the cause in
      // payload.error ({message, attribution:{statusCode, reason, ...}}).
      const errorRecord = readObjectRecord(payload.error);
      return [createNormalizedMessage({
        id: baseId,
        sessionId: eventSessionId,
        timestamp,
        provider: PROVIDER,
        kind: 'error',
        isError: true,
        text: readOptionalString(errorRecord?.message)
          ?? readOptionalString(payload.error)
          ?? readOptionalString(payload.message)
          ?? 'Unknown ZCode error',
      })];
    }

    // Unknown event type - skip
    return [];
  }

  /**
   * Normalizes `model_streaming` payload kinds per the Phase 0.3 mapping
   * table: text deltas stream, reasoning deltas think, tool announcements
   * map to tool_use/tool_result. Boundary markers carry empty deltas and are
   * skipped by the empty-content checks.
   */
  private normalizeStreamingKind(
    payload: AnyRecord,
    eventSessionId: string | null,
    timestamp: string,
    baseId: string,
  ): NormalizedMessage[] {
    const kind = readOptionalString(payload.kind);

    if (kind === 'text_delta') {
      const content = extractText(payload.delta);
      if (!content) {
        return [];
      }

      return [createNormalizedMessage({
        id: baseId,
        sessionId: eventSessionId,
        timestamp,
        provider: PROVIDER,
        kind: 'stream_delta',
        role: 'assistant',
        content,
      })];
    }

    if (kind === 'reasoning_delta') {
      const content = extractText(payload.delta);
      if (!content) {
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

    if (kind === 'tool_call') {
      return [createNormalizedMessage({
        id: baseId,
        sessionId: eventSessionId,
        timestamp,
        provider: PROVIDER,
        kind: 'tool_use',
        toolName: readOptionalString(payload.toolName) ?? 'Tool',
        toolInput: payload.input ?? {},
        toolId: readOptionalString(payload.toolCallId) ?? baseId,
      })];
    }

    if (kind === 'tool_result') {
      // Streaming tool results only reference the persisted part id; the
      // full output arrives later through the SQLite sync path.
      const resultPartId = readOptionalString(payload.resultPartId);
      return [createNormalizedMessage({
        id: baseId,
        sessionId: eventSessionId,
        timestamp,
        provider: PROVIDER,
        kind: 'tool_result',
        toolId: readOptionalString(payload.toolCallId) ?? baseId,
        toolResult: {
          content: resultPartId ? `Result stored in part ${resultPartId}` : '',
          isError: false,
        },
      })];
    }

    return [];
  }

  /**
   * Loads ZCode session history from SQLite database.
   *
   * Uses read-only connection to query message and part tables with proper
   * pagination (LIMIT/OFFSET). Joins with part table for full message content.
   * Uses the existing sequence column and message_session_time_created_id_idx index.
   *
   * Filter out sub-agent sessions (sess_subagent_agent_*) per plan requirements.
   */
  async fetchHistory(
    sessionId: string,
    options: FetchHistoryOptions = {},
  ): Promise<FetchHistoryResult> {
    const { limit = null, offset = 0 } = options;

    // Filter out sub-agent sessions
    if (sessionId.startsWith('sess_subagent_agent_')) {
      return { messages: [], total: 0, hasMore: false, offset: 0, limit: null };
    }

    // ZCode's SQLite database keys messages by the provider-native session id
    const providerSessionId = options.providerSessionId ?? sessionId;
    const db = openZCodeDatabase();

    if (!db) {
      return { messages: [], total: 0, hasMore: false, offset: 0, limit: null };
    }

    try {
      const rows = db.prepare(`
        SELECT
          m.id AS message_id,
          m.time_created AS message_time_created,
          m.sequence AS message_sequence,
          m.data AS message_data,
          p.id AS part_id,
          p.time_created AS part_time_created,
          p.data AS part_data
        FROM message m
        LEFT JOIN part p
          ON p.session_id = m.session_id
         AND p.message_id = m.id
        WHERE m.session_id = ?
        ORDER BY
          COALESCE(m.time_created, 0),
          m.sequence,
          m.id,
          COALESCE(p.time_created, 0),
          p.id
      `).all(providerSessionId) as ZCodeHistoryRow[];

      const normalized = this.normalizeHistoryRows(rows, sessionId);
      const tokenUsage = aggregateZCodeSessionTokenUsage(db, providerSessionId);

      const normalizedOffset = Math.max(0, offset);
      const normalizedLimit = limit === null ? null : Math.max(0, limit);
      const total = normalized.length;
      const { page, hasMore } = sliceTailPage(normalized, normalizedLimit, normalizedOffset);

      return {
        messages: page,
        total,
        hasMore,
        offset: normalizedOffset,
        limit: normalizedLimit,
        tokenUsage,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[ZCodeProvider] Failed to load session ${sessionId}:`, message);
      return { messages: [], total: 0, hasMore: false, offset: 0, limit: null };
    } finally {
      db.close();
    }
  }

  /**
   * Normalize SQLite history rows into NormalizedMessage format.
   *
   * Parses message.data JSON for role/modelID/tokens and handles the part
   * table's type discriminator (`text`/`reasoning`/`tool`/`step-finish`)
   * per the Phase 0.3 SQLite schema. Applies suffix to fragment IDs for
   * uniqueness per §5.1 of the plan.
   */
  private normalizeHistoryRows(rows: ZCodeHistoryRow[], sessionId: string): NormalizedMessage[] {
    const normalized: NormalizedMessage[] = [];
    const emittedMessageErrors = new Set<string>();
    const emittedUserTexts = new Set<string>();

    for (const row of rows) {
      const timestamp = normalizeProviderTimestamp(row.part_time_created ?? row.message_time_created);
      // Apply suffix to fragment IDs for uniqueness per §5.1
      const baseId = `${row.message_id}_${row.part_id ?? normalized.length}`;
      const messageInfo = readJsonRecord(row.message_data);
      const messageRole = readOptionalString(messageInfo?.role);

      // Handle message-level errors
      if (
        messageInfo
        && messageRole === 'assistant'
        && messageInfo.error != null
        && !emittedMessageErrors.has(row.message_id)
      ) {
        emittedMessageErrors.add(row.message_id);
        normalized.push(createNormalizedMessage({
          id: `${baseId}_error`,
          sessionId,
          timestamp,
          provider: PROVIDER,
          kind: 'error',
          content: formatToolContent(messageInfo.error),
        }));
      }

      // Skip rows without part data
      if (!row.part_id || !row.part_data) {
        // User prompts can persist their text on the message row itself
        // (Phase 0.3 §4.1) instead of in a part; emit it once per message.
        if (messageRole === 'user' && !emittedUserTexts.has(row.message_id)) {
          const content = extractText(messageInfo?.text ?? messageInfo?.input ?? messageInfo?.content);
          if (content.trim()) {
            emittedUserTexts.add(row.message_id);
            normalized.push(createNormalizedMessage({
              id: `${row.message_id}_text`,
              sessionId,
              timestamp,
              provider: PROVIDER,
              kind: 'text',
              role: 'user',
              content,
            }));
          }
        }
        continue;
      }

      const partData = readJsonRecord(row.part_data);
      if (!partData) {
        continue;
      }

      const partType = readOptionalString(partData.type);

      // Handle text parts
      if (partType === 'text') {
        const content = extractText(partData);
        if (content.trim()) {
          normalized.push(createNormalizedMessage({
            id: baseId,
            sessionId,
            timestamp,
            provider: PROVIDER,
            kind: 'text',
            role: messageRole === 'user' ? 'user' : 'assistant',
            content,
          }));
        }
        continue;
      }

      // Handle thinking/reasoning parts
      if (partType === 'reasoning' || partType === 'thinking') {
        const content = extractText(partData);
        if (content.trim()) {
          normalized.push(createNormalizedMessage({
            id: baseId,
            sessionId,
            timestamp,
            provider: PROVIDER,
            kind: 'thinking',
            content,
          }));
        }
        continue;
      }

      // Handle tool parts (callID/tool/state per Phase 0.3 part schema)
      if (partType === 'tool' || partType === 'function_call') {
        const toolName = readOptionalString(partData.tool) ?? readOptionalString(partData.name) ?? 'Tool';
        const state = readObjectRecord(partData.state);

        const toolMessage = createNormalizedMessage({
          id: baseId,
          sessionId,
          timestamp,
          provider: PROVIDER,
          kind: 'tool_use',
          toolName,
          toolInput: state?.input ?? partData.input ?? {},
          toolId: readOptionalString(partData.callID) ?? row.part_id,
        });

        if (state) {
          const status = readOptionalString(state.status);
          if (status === 'completed' || status === 'error') {
            toolMessage.toolResult = {
              content: formatToolContent(state.output ?? state.error),
              isError: status === 'error',
            };
          }
        }

        normalized.push(toolMessage);
        continue;
      }

      // Handle step completion (run end marker)
      if (partType === 'step-finish' || partType === 'done') {
        normalized.push(createNormalizedMessage({
          id: baseId,
          sessionId,
          timestamp,
          provider: PROVIDER,
          kind: 'complete',
          tokens: readTokenUsedCount(messageInfo?.tokens),
        }));
        continue;
      }
    }

    return normalized;
  }
}
