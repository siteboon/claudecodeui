import fsSync from 'node:fs';

import Database from 'better-sqlite3';

import { isOpenCodeSessionActive } from '@/modules/providers/list/opencode/opencode-runtime.provider.js';
import { parseFilesInputTag, parseImagesInputTag } from '@/shared/image-attachments.js';
import type { IProviderSessions } from '@/shared/interfaces.js';
import type {
  AnyRecord,
  FetchHistoryOptions,
  FetchHistoryResult,
  NormalizedMessage,
  SubagentActivity,
  SubagentInfo,
} from '@/shared/types.js';
import {
  createNormalizedMessage,
  generateMessageId,
  getOpenCodeDatabasePath,
  normalizeProviderTimestamp,
  readObjectRecord,
  readJsonRecord,
  readOptionalString,
  sliceTailPage,
  truncateSubagentActivity,
  unwrapJsonStringLiteral,
} from '@/shared/utils.js';

const PROVIDER = 'opencode';

/** OpenCode's tool for spawning a subagent; it runs in a child session of the caller. */
const SUBAGENT_TOOL_NAME = 'task';

/** Upper bound on how much of a subagent's timeline is sent to the client, as for Claude and Codex. */
const MAX_TRANSMITTED_SUBAGENT_ACTIVITIES = 200;

type OpenCodeHistoryRow = {
  message_id: string | null;
  message_time_created: number | null;
  message_data: string | null;
  part_id: string | null;
  part_time_created: number | null;
  part_data: string | null;
};

/**
 * A message or part as the history outline reads it: `digest` is a trimmed
 * copy of its JSON `data` (see READABLE_JSON_DATA), and `data` is the raw
 * column, read only when there is no digest.
 */
type OpenCodeOutlineMessageRow = {
  id: string | null;
  time_created: number | null;
  digest: string | null;
  data: unknown;
};

type OpenCodeOutlinePartRow = {
  id: string | null;
  message_id: string | null;
  time_created: number | null;
  digest: string | null;
  data: unknown;
};

/**
 * One row of a session's history (a part, or a message without parts) placed
 * in the full normalized history without being normalized.
 */
type OpenCodeHistoryOutlineRow = {
  messageId: string | null;
  messageTimeCreated: number | null;
  partId: string | null;
  partTimeCreated: number | null;
  /** Whether this row shows its message's error: only the message's first row can. */
  showsMessageError: boolean;
  /** Position of this row's first normalized message in the full history. */
  start: number;
  /** How many normalized messages this row turns into: 0, 1 or 2. */
  count: number;
};

type OpenCodeTokenTotals = {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

const openOpenCodeDatabase = (): Database.Database | null => {
  const dbPath = getOpenCodeDatabasePath();
  if (!fsSync.existsSync(dbPath)) {
    return null;
  }

  return new Database(dbPath, { readonly: true, fileMustExist: true });
};

const formatToolContent = (value: unknown): string => {
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
};

const extractText = (value: unknown): string => {
  if (typeof value === 'string') {
    return unwrapJsonStringLiteral(value);
  }

  const record = readObjectRecord(value);
  const text = readOptionalString(record?.text)
    ?? readOptionalString(record?.content)
    ?? '';
  return unwrapJsonStringLiteral(text);
};

const hasUserRole = (value: unknown): boolean => {
  const record = readObjectRecord(value);
  return readOptionalString(record?.role) === 'user';
};

// `opencode run --format json` nests each event's payload under `part`; older builds sent it flat.
const readEventPart = (raw: AnyRecord): AnyRecord => readObjectRecord(raw.part) ?? {};

// Error events carry an object (`{ name, data }`), not a string.
const readEventError = (value: unknown): string | undefined => {
  const record = readObjectRecord(value);
  if (!record) {
    return readOptionalString(value);
  }

  const data = readObjectRecord(record.data);
  const message = readOptionalString(data?.message) ?? readOptionalString(record.message);
  if (message) {
    return message;
  }

  const name = readOptionalString(record.name);
  const providerId = readOptionalString(data?.providerID) ?? readOptionalString(record.providerID);
  const modelId = readOptionalString(data?.modelID) ?? readOptionalString(record.modelID);
  if (providerId && modelId) {
    return `${name ?? 'Error'}: ${providerId}/${modelId}`;
  }

  const details = data ? JSON.stringify(data).slice(0, 200) : '';
  return [name, details].filter(Boolean).join(': ') || undefined;
};

const isUserTextEcho = (raw: AnyRecord): boolean => {
  return readOptionalString(raw.role) === 'user'
    || hasUserRole(raw.message)
    || hasUserRole(raw.part);
};

/** OpenCode's ask-the-user tool. */
const QUESTION_TOOL_NAME = 'question';

/**
 * Rewrites a `question` call onto the AskUserQuestion card the chat already
 * renders for Claude's and Codex's questions: OpenCode's `multiple` becomes
 * `multiSelect`, and the labels the user picked, which OpenCode keeps in
 * `metadata.answers` as one list per question, are folded into the input
 * keyed by question text, the shape the card reads.
 */
const toAskUserQuestionCall = (toolMessage: NormalizedMessage, toolState: AnyRecord): void => {
  const input = readObjectRecord(toolState.input) ?? readObjectRecord(toolMessage.toolInput);
  if (!input || !Array.isArray(input.questions)) {
    return;
  }

  const answerLists = readObjectRecord(toolState.metadata)?.answers;
  const answers: Record<string, string> = {};
  const questions = input.questions.map((entry: unknown, index: number) => {
    const question = readObjectRecord(entry);
    if (!question) {
      return entry;
    }

    const text = readOptionalString(question.question);
    const picked = Array.isArray(answerLists) && Array.isArray(answerLists[index])
      ? (answerLists[index] as unknown[]).filter((label): label is string => typeof label === 'string' && label.trim().length > 0)
      : [];
    if (text && picked.length > 0) {
      answers[text] = picked.join(', ');
    }

    const { multiple, ...rest } = question;
    return { ...rest, multiSelect: multiple === true };
  });

  toolMessage.toolName = 'AskUserQuestion';
  toolMessage.toolInput = Object.keys(answers).length > 0
    ? { ...input, questions, answers }
    : { ...input, questions };
};

/**
 * Whether an assistant message's error only records that its turn was stopped.
 * Stopping a turn aborts the OpenCode session, which stores this error on the
 * message it interrupted; the live chat never shows it as a failure, so the
 * history does not either.
 */
const isStoppedTurnError = (error: unknown): boolean =>
  readOptionalString(readObjectRecord(error)?.name) === 'MessageAbortedError';

const buildTokenUsage = (totals: OpenCodeTokenTotals | undefined): AnyRecord | undefined => {
  if (!totals) {
    return undefined;
  }

  const inputTokens = totals.inputTokens;
  const displayInputTokens = inputTokens + totals.cacheReadTokens;
  const outputTokens = totals.outputTokens;
  const used = inputTokens
    + outputTokens
    + totals.reasoningTokens
    + totals.cacheReadTokens
    + totals.cacheWriteTokens;

  if (used <= 0) {
    return undefined;
  }

  return {
    used,
    inputTokens: displayInputTokens,
    outputTokens,
    breakdown: {
      input: displayInputTokens,
      output: outputTokens,
    },
  };
};

const readOpenCodeSessionColumnTokenUsage = (
  db: Database.Database,
  sessionId: string,
): AnyRecord | undefined => {
  const columns = db.prepare('PRAGMA table_info(session)').all() as { name: string }[];
  const columnNames = new Set(columns.map((column) => column.name));
  const requiredColumns = ['tokens_input', 'tokens_output', 'tokens_reasoning', 'tokens_cache_read', 'tokens_cache_write'];
  if (!requiredColumns.every((column) => columnNames.has(column))) {
    return undefined;
  }

  const row = db.prepare(`
    SELECT
      tokens_input AS inputTokens,
      tokens_output AS outputTokens,
      tokens_reasoning AS reasoningTokens,
      tokens_cache_read AS cacheReadTokens,
      tokens_cache_write AS cacheWriteTokens
    FROM session
    WHERE id = ?
  `).get(sessionId) as OpenCodeTokenTotals | undefined;

  if (!row) {
    return undefined;
  }

  return buildTokenUsage({
    inputTokens: Number(row.inputTokens ?? 0),
    outputTokens: Number(row.outputTokens ?? 0),
    reasoningTokens: Number(row.reasoningTokens ?? 0),
    cacheReadTokens: Number(row.cacheReadTokens ?? 0),
    cacheWriteTokens: Number(row.cacheWriteTokens ?? 0),
  });
};

/**
 * OpenCode stores per-message token counts on assistant `message.data` objects
 * (see MessageV2.Assistant). Older DBs also had session-level counters; this
 * matches current `opencode.db` layouts that only persist message JSON.
 */
const aggregateOpenCodeSessionTokenUsage = (
  db: Database.Database,
  sessionId: string,
): AnyRecord | undefined => {
  const sessionColumnUsage = readOpenCodeSessionColumnTokenUsage(db, sessionId);
  if (sessionColumnUsage) {
    return sessionColumnUsage;
  }

  const rows = db.prepare('SELECT data FROM message WHERE session_id = ?').all(sessionId) as { data: string }[];

  let inputTokens = 0;
  let outputTokens = 0;
  let reasoningTokens = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;

  for (const row of rows) {
    const info = readJsonRecord(row.data);
    if (readOptionalString(info?.role) !== 'assistant') {
      continue;
    }

    const tokens = readObjectRecord(info?.tokens);
    if (!tokens) {
      continue;
    }

    inputTokens += Number(tokens.input ?? 0);
    outputTokens += Number(tokens.output ?? 0);
    reasoningTokens += Number(tokens.reasoning ?? 0);
    const cache = readObjectRecord(tokens.cache);
    cacheReadTokens += Number(cache?.read ?? 0);
    cacheWriteTokens += Number(cache?.write ?? 0);
  }

  return buildTokenUsage({
    inputTokens,
    outputTokens,
    reasoningTokens,
    cacheReadTokens,
    cacheWriteTokens,
  });
};

const readToolResult = (state: AnyRecord): SubagentActivity['toolResult'] => {
  const status = readOptionalString(state.status);
  if (status !== 'completed' && status !== 'error') {
    return null;
  }

  return {
    content: formatToolContent(state.output ?? state.error),
    isError: status === 'error',
  };
};

/**
 * Flattens the child session a `task` call spawned into the shared subagent
 * timeline. OpenCode keeps it in the same database as the parent.
 */
const readOpenCodeSubagentActivity = (
  db: Database.Database,
  childSessionId: string,
): SubagentActivity[] => {
  const rows = db.prepare(`
    SELECT p.data AS part_data, p.time_created AS part_time_created
    FROM part p
    INNER JOIN message m
      ON m.id = p.message_id
     AND m.session_id = p.session_id
    WHERE p.session_id = ?
      AND json_extract(m.data, '$.role') = 'assistant'
    ORDER BY COALESCE(m.time_created, 0), m.id, COALESCE(p.time_created, 0), p.id
  `).all(childSessionId) as { part_data: string | null; part_time_created: number | null }[];

  const activity: SubagentActivity[] = [];
  for (const row of rows) {
    const partData = readJsonRecord(row.part_data) ?? {};
    const timestamp = normalizeProviderTimestamp(row.part_time_created);
    const partType = readOptionalString(partData.type);

    if (partType === 'tool') {
      const state = readObjectRecord(partData.state) ?? {};
      activity.push({
        kind: 'tool',
        toolId: readOptionalString(partData.callID) ?? readOptionalString(partData.id),
        toolName: readOptionalString(partData.tool) ?? 'Tool',
        toolInput: state.input ?? {},
        toolResult: readToolResult(state),
        timestamp,
      });
      continue;
    }

    if (partType === 'text' || partType === 'reasoning') {
      const content = extractText(partData);
      if (content.trim()) {
        activity.push({ kind: partType === 'text' ? 'text' : 'thinking', content, timestamp });
      }
    }
  }

  return activity;
};

// The task tool wraps the subagent's answer as `<task …><task_result>…</task_result></task>`.
const TASK_OUTPUT_PATTERN = /<task_(result|error)>\n?([\s\S]*?)\n?<\/task_\1>/;

const unwrapTaskOutput = (content: string): string => {
  const match = TASK_OUTPUT_PATTERN.exec(content);
  return match ? match[2] : content;
};

/**
 * Turns a `task` tool row into a subagent container, the way Claude's `Agent`
 * rows are: identity from the call, timeline from the child session.
 *
 * `runIsLive` says whether a run of this session is still in progress: a task
 * without a result outside one was stopped and will never report.
 */
const attachOpenCodeSubagent = (
  message: NormalizedMessage,
  state: AnyRecord,
  db: Database.Database | null,
  runIsLive: boolean,
): void => {
  if (message.toolName !== SUBAGENT_TOOL_NAME) {
    return;
  }

  const input = readObjectRecord(state.input) ?? {};
  const metadata = readObjectRecord(state.metadata) ?? {};
  const childSessionId = readOptionalString(metadata.sessionId);
  const toolResult = message.toolResult;
  let status: SubagentInfo['status'] = runIsLive ? 'running' : 'stopped';
  if (metadata.interrupted === true) {
    status = 'stopped';
  } else if (toolResult) {
    status = toolResult.isError ? 'failed' : 'completed';
  }

  if (toolResult?.content) {
    toolResult.content = unwrapTaskOutput(toolResult.content);
  }

  const subagent: SubagentInfo = {
    id: childSessionId ?? message.toolId ?? message.id,
    type: readOptionalString(input.subagent_type),
    description: readOptionalString(input.description),
    status,
    model: readOptionalString(readObjectRecord(metadata.model)?.modelID),
  };

  if (db && childSessionId) {
    try {
      const activity = readOpenCodeSubagentActivity(db, childSessionId);
      if (activity.length > 0) {
        // Keep the latest steps: the timeline says the missing ones are the earlier ones.
        message.subagentTools = activity
          .slice(-MAX_TRANSMITTED_SUBAGENT_ACTIVITIES)
          .map(truncateSubagentActivity);
        subagent.activityCount = activity.length;
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(`[OpenCodeProvider] Failed to read subagent session ${childSessionId}:`, reason);
    }
  }

  message.subagent = subagent;
};

/** Opens the shared database for a live event, or null when it cannot be read right now. */
const openOpenCodeDatabaseForLiveEvent = (): Database.Database | null => {
  try {
    return openOpenCodeDatabase();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn('[OpenCodeProvider] Failed to open opencode.db for a live event:', reason);
    return null;
  }
};

/**
 * What a text part shows: its text without the attachment blocks a user
 * prompt carries, and those attachments. Null when nothing is left to show.
 */
const readShownTextPart = (partData: AnyRecord, messageRole: string | undefined) => {
  const rawContent = extractText(partData);
  // User prompts sent with attachments carry an <images_input> path
  // list; strip it for display and surface the paths as images.
  const parsedImages = messageRole === 'user'
    ? parseImagesInputTag(rawContent)
    : { text: rawContent, attachments: [] };
  const parsedFiles = messageRole === 'user'
    ? parseFilesInputTag(parsedImages.text)
    : { text: rawContent, attachments: [] };
  if (
    !parsedFiles.text.trim()
    && parsedImages.attachments.length === 0
    && parsedFiles.attachments.length === 0
  ) {
    return null;
  }

  return {
    content: parsedFiles.text,
    images: parsedImages.attachments.length > 0 ? parsedImages.attachments : undefined,
    files: parsedFiles.attachments.length > 0 ? parsedFiles.attachments : undefined,
  };
};

/** The text a reasoning part shows, or null when it is blank. */
const readShownReasoning = (partData: AnyRecord): string | null => {
  const content = extractText(partData);
  return content.trim() ? content : null;
};

/**
 * How many messages a part shows in the history. These are the decisions
 * `normalizeHistoryRow` makes, taken without building anything, so keep the
 * two in step: opencode-history-pages.test.ts checks that they agree on every
 * part type OpenCode writes.
 */
const countShownPartMessages = (partData: AnyRecord, messageRole: string | undefined): number => {
  switch (readOptionalString(partData.type)) {
    case 'text':
      return readShownTextPart(partData, messageRole) ? 1 : 0;
    case 'reasoning':
      return readShownReasoning(partData) === null ? 0 : 1;
    case 'tool':
    case 'step-finish':
    case 'patch':
    case 'agent':
      return 1;
    default:
      return 0;
  }
};

/**
 * Rows SQLite can read as JSON text get a digest: a copy of their JSON with
 * only the keys counting a row needs. SQLite reads them in place, so a tool's
 * output, a diff or an attached file is not copied into JavaScript just to be
 * counted. Any other row carries its raw `data`, which the outline then
 * parses as the full read always has.
 */
const READABLE_JSON_DATA = "typeof(data) = 'text' AND json_valid(data)";

const HISTORY_OUTLINE_MESSAGES_SQL = `
  SELECT
    id,
    time_created,
    CASE WHEN ${READABLE_JSON_DATA}
      THEN json_object('role', data -> '$.role', 'error', data -> '$.error')
    END AS digest,
    CASE WHEN ${READABLE_JSON_DATA} THEN NULL ELSE data END AS data
  FROM message
  WHERE session_id = ?
  ORDER BY COALESCE(time_created, 0), id
`;

const HISTORY_OUTLINE_PARTS_SQL = `
  SELECT
    id,
    message_id,
    time_created,
    CASE WHEN ${READABLE_JSON_DATA}
      THEN json_object('type', data -> '$.type', 'text', data -> '$.text', 'content', data -> '$.content')
    END AS digest,
    CASE WHEN ${READABLE_JSON_DATA} THEN NULL ELSE data END AS data
  FROM part
  WHERE session_id = ?
  ORDER BY COALESCE(time_created, 0), id
`;

/**
 * Places every row of a session's history: each message's parts in order, or
 * one row for a message without parts, messages ordered by creation. That is
 * the order of a `message LEFT JOIN part` sorted by message then part, read
 * as two queries so neither scans the session's parts once per message.
 */
const readOpenCodeHistoryOutline = (
  db: Database.Database,
  providerSessionId: string,
): OpenCodeHistoryOutlineRow[] => {
  const messages = db.prepare(HISTORY_OUTLINE_MESSAGES_SQL).all(providerSessionId) as OpenCodeOutlineMessageRow[];
  const parts = db.prepare(HISTORY_OUTLINE_PARTS_SQL).all(providerSessionId) as OpenCodeOutlinePartRow[];

  // As in a join, a NULL id matches nothing: such a part is skipped, and such
  // a message has no parts.
  const partsByMessage = new Map<string | null, OpenCodeOutlinePartRow[]>();
  for (const part of parts) {
    if (part.message_id === null) {
      continue;
    }

    const messageParts = partsByMessage.get(part.message_id);
    if (messageParts) {
      messageParts.push(part);
    } else {
      partsByMessage.set(part.message_id, [part]);
    }
  }

  const outline: OpenCodeHistoryOutlineRow[] = [];
  const emittedMessageErrors = new Set<string | null>();
  let position = 0;
  for (const message of messages) {
    const messageInfo = readJsonRecord(message.digest ?? message.data);
    const messageRole = readOptionalString(messageInfo?.role);
    const messageParts: (OpenCodeOutlinePartRow | null)[] = partsByMessage.get(message.id) ?? [null];

    for (const part of messageParts) {
      // A message's error shows once, on its first row, unless it only
      // records that the turn was stopped.
      let showsMessageError = false;
      if (
        messageInfo
        && messageRole === 'assistant'
        && messageInfo.error != null
        && !emittedMessageErrors.has(message.id)
      ) {
        emittedMessageErrors.add(message.id);
        showsMessageError = !isStoppedTurnError(messageInfo.error);
      }

      const partId = part ? part.id : null;
      const shownPartMessages = part && partId
        ? countShownPartMessages(readJsonRecord(part.digest ?? part.data) ?? {}, messageRole)
        : 0;
      const count = (showsMessageError ? 1 : 0) + shownPartMessages;
      outline.push({
        messageId: message.id,
        messageTimeCreated: message.time_created,
        partId,
        partTimeCreated: part ? part.time_created : null,
        showsMessageError,
        start: position,
        count,
      });
      position += count;
    }
  }

  return outline;
};

export class OpenCodeSessionsProvider implements IProviderSessions {
  /**
   * Normalizes live OpenCode events into frontend messages. The OpenCode
   * runtime forwards each finished part in the shape `opencode run --format json`
   * printed (`{ type, timestamp, sessionID, part }`), so sessions recorded
   * before the SDK runtime and live turns go through the same mapping.
   */
  normalizeMessage(rawMessage: unknown, sessionId: string | null): NormalizedMessage[] {
    const raw = readObjectRecord(rawMessage);
    if (!raw) {
      return [];
    }

    const type = readOptionalString(raw.type) ?? readOptionalString(raw.event);
    const eventSessionId = readOptionalString(raw.sessionID) ?? readOptionalString(raw.sessionId) ?? sessionId;
    const timestamp = normalizeProviderTimestamp(raw.time ?? raw.timestamp);
    const part = readEventPart(raw);
    const toolState = readObjectRecord(part.state) ?? {};
    const partMessageId = readOptionalString(part.messageID);
    const partId = readOptionalString(part.id);
    // Same id the history reader gives this part, so a reload does not duplicate it.
    const baseId = (partMessageId && partId ? `${partMessageId}_${partId}` : undefined)
      ?? readOptionalString(raw.id)
      ?? readOptionalString(raw.messageID)
      ?? generateMessageId('opencode');

    if (type === 'text') {
      // The client already renders an optimistic user bubble, so provider user
      // echoes must not be streamed back as assistant text.
      if (isUserTextEcho(raw)) {
        return [];
      }

      const content = extractText(raw.text ?? raw.delta ?? raw.message ?? part.text);
      if (!content.trim()) {
        return [];
      }

      // A nested text part arrives once, complete: as its own assistant row it
      // keeps the history id instead of merging with the next part's stream.
      if (typeof part.text === 'string') {
        return [createNormalizedMessage({
          id: baseId,
          sessionId: eventSessionId,
          timestamp,
          provider: PROVIDER,
          kind: 'text',
          role: 'assistant',
          content,
        })];
      }

      return [createNormalizedMessage({
        id: baseId,
        sessionId: eventSessionId,
        timestamp,
        provider: PROVIDER,
        kind: 'stream_delta',
        content,
      })];
    }

    if (type === 'reasoning') {
      const content = extractText(raw.text ?? raw.delta ?? raw.message ?? part.text);
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

    if (type === 'tool_use') {
      const toolName = readOptionalString(raw.tool) ?? readOptionalString(raw.name) ?? readOptionalString(part.tool) ?? 'Tool';
      const toolId = readOptionalString(raw.callID) ?? readOptionalString(raw.toolCallId) ?? readOptionalString(part.callID) ?? baseId;
      const toolMessage = createNormalizedMessage({
        id: baseId,
        sessionId: eventSessionId,
        timestamp,
        provider: PROVIDER,
        kind: 'tool_use',
        toolName,
        toolInput: raw.input ?? raw.arguments ?? toolState.input ?? {},
        toolId,
      });

      const toolStatus = readOptionalString(toolState.status);
      if (raw.output !== undefined || raw.error !== undefined) {
        toolMessage.toolResult = {
          content: formatToolContent(raw.output ?? raw.error),
          isError: raw.error !== undefined,
        };
      } else if (toolStatus === 'completed' || toolStatus === 'error') {
        toolMessage.toolResult = {
          content: formatToolContent(toolState.output ?? toolState.error),
          isError: toolStatus === 'error',
        };
      }

      if (toolName === QUESTION_TOOL_NAME) {
        toAskUserQuestionCall(toolMessage, toolState);
      }

      if (toolName === SUBAGENT_TOOL_NAME) {
        // A task is forwarded only once it has finished, so its child session
        // is complete in the database by now.
        const db = openOpenCodeDatabaseForLiveEvent();
        try {
          attachOpenCodeSubagent(toolMessage, toolState, db, true);
        } finally {
          db?.close();
        }
      }

      return [toolMessage];
    }

    if (type === 'error') {
      return [createNormalizedMessage({
        id: baseId,
        sessionId: eventSessionId,
        timestamp,
        provider: PROVIDER,
        kind: 'error',
        content: readEventError(raw.error) ?? readOptionalString(raw.message) ?? 'Unknown OpenCode error',
      })];
    }

    if (type === 'step_finish') {
      return [createNormalizedMessage({
        id: baseId,
        sessionId: eventSessionId,
        timestamp,
        provider: PROVIDER,
        kind: 'stream_end',
      })];
    }

    return [];
  }

  /**
   * Loads OpenCode history from the shared SQLite session database.
   *
   * The outline (every row's ids, timestamps and SQLite-side JSON digest)
   * gives `total` and the page bounds; only the rows on the requested page are
   * then read in full, normalized and given their subagent timelines. The
   * result is what slicing the fully normalized history would return.
   */
  async fetchHistory(
    sessionId: string,
    options: FetchHistoryOptions = {},
  ): Promise<FetchHistoryResult> {
    const { limit = null, offset = 0 } = options;
    // OpenCode's shared sqlite database keys messages by the provider-native
    // session id, not the app-facing id this method is addressed with.
    const providerSessionId = options.providerSessionId ?? sessionId;
    const db = openOpenCodeDatabase();
    if (!db) {
      return { messages: [], total: 0, hasMore: false, offset: 0, limit: null };
    }

    try {
      const normalizedOffset = Math.max(0, offset);
      const normalizedLimit = limit === null ? null : Math.max(0, limit);

      // One read transaction, so the page is cut from the rows the outline counted.
      return db.transaction((): FetchHistoryResult => {
        const outline = readOpenCodeHistoryOutline(db, providerSessionId);
        const lastRow = outline.at(-1);
        const total = lastRow ? lastRow.start + lastRow.count : 0;
        // Slicing positions with the shared helper gives the page bounds and
        // `hasMore` that slicing the normalized messages themselves would.
        const positions = Array.from({ length: total }, (_, position) => position);
        const { page, hasMore } = sliceTailPage(positions, normalizedLimit, normalizedOffset);
        const messages = page.length > 0
          ? this.normalizeHistoryPage(db, outline, page[0], page[page.length - 1] + 1, sessionId)
          : [];
        const tokenUsage = aggregateOpenCodeSessionTokenUsage(db, providerSessionId);

        return {
          messages,
          total,
          hasMore,
          offset: normalizedOffset,
          limit: normalizedLimit,
          tokenUsage,
        };
      })();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[OpenCodeProvider] Failed to load session ${sessionId}:`, message);
      return { messages: [], total: 0, hasMore: false, offset: 0, limit: null };
    } finally {
      db.close();
    }
  }

  /**
   * Normalizes the messages at positions [from, to) of the full history,
   * reading in full only the rows they come from.
   */
  private normalizeHistoryPage(
    db: Database.Database,
    outline: OpenCodeHistoryOutlineRow[],
    from: number,
    to: number,
    sessionId: string,
  ): NormalizedMessage[] {
    const readMessageData = db.prepare('SELECT data FROM message WHERE id = ?').pluck();
    const readPartData = db.prepare('SELECT data FROM part WHERE id = ?').pluck();
    const messageDataById = new Map<string | null, string | null>();
    const runIsLive = isOpenCodeSessionActive(sessionId);
    const page: NormalizedMessage[] = [];

    for (const outlineRow of outline) {
      if (outlineRow.start >= to) {
        break;
      }
      if (outlineRow.count === 0 || outlineRow.start + outlineRow.count <= from) {
        continue;
      }

      let messageData = messageDataById.get(outlineRow.messageId);
      if (messageData === undefined) {
        messageData = (readMessageData.get(outlineRow.messageId) as string | null | undefined) ?? null;
        messageDataById.set(outlineRow.messageId, messageData);
      }

      const row: OpenCodeHistoryRow = {
        message_id: outlineRow.messageId,
        message_time_created: outlineRow.messageTimeCreated,
        message_data: messageData,
        part_id: outlineRow.partId,
        part_time_created: outlineRow.partTimeCreated,
        part_data: outlineRow.partId
          ? (readPartData.get(outlineRow.partId) as string | null | undefined) ?? null
          : null,
      };
      const rowMessages = this.normalizeHistoryRow(row, outlineRow, db, sessionId, runIsLive);
      rowMessages.forEach((message, index) => {
        const position = outlineRow.start + index;
        if (position >= from && position < to) {
          page.push(message);
        }
      });
    }

    return page;
  }

  /**
   * Turns one history row into its normalized messages: its message's error
   * when the outline placed it on this row, then what its part shows.
   */
  private normalizeHistoryRow(
    row: OpenCodeHistoryRow,
    placement: Pick<OpenCodeHistoryOutlineRow, 'showsMessageError' | 'start'>,
    db: Database.Database,
    sessionId: string,
    runIsLive: boolean,
  ): NormalizedMessage[] {
    const normalized: NormalizedMessage[] = [];
    const timestamp = normalizeProviderTimestamp(row.part_time_created ?? row.message_time_created);
    // A part-less row is keyed by its position in the full history, so it
    // keeps the same id on every page that shows it.
    const baseId = `${row.message_id}_${row.part_id ?? placement.start}`;
    const messageInfo = readJsonRecord(row.message_data);
    const messageRole = readOptionalString(messageInfo?.role);

    if (placement.showsMessageError) {
      normalized.push(createNormalizedMessage({
        id: `${baseId}_error`,
        sessionId,
        timestamp,
        provider: PROVIDER,
        kind: 'error',
        content: formatToolContent(messageInfo?.error),
      }));
    }

    if (!row.part_id) {
      return normalized;
    }

    const partData = readJsonRecord(row.part_data) ?? {};
    const partType = readOptionalString(partData.type);

    if (partType === 'text') {
      const shownText = readShownTextPart(partData, messageRole);
      if (shownText) {
        normalized.push(createNormalizedMessage({
          id: baseId,
          sessionId,
          timestamp,
          provider: PROVIDER,
          kind: 'text',
          role: messageRole === 'user' ? 'user' : 'assistant',
          content: shownText.content,
          images: shownText.images,
          files: shownText.files,
        }));
      }
      return normalized;
    }

    if (partType === 'reasoning') {
      const content = readShownReasoning(partData);
      if (content !== null) {
        normalized.push(createNormalizedMessage({
          id: baseId,
          sessionId,
          timestamp,
          provider: PROVIDER,
          kind: 'thinking',
          content,
        }));
      }
      return normalized;
    }

    if (partType === 'tool') {
      const state = readObjectRecord(partData.state) ?? {};
      const status = readOptionalString(state.status);
      const toolMessage = createNormalizedMessage({
        id: baseId,
        sessionId,
        timestamp,
        provider: PROVIDER,
        kind: 'tool_use',
        toolName: readOptionalString(partData.tool) ?? 'Tool',
        toolInput: state.input ?? partData.input ?? {},
        toolId: readOptionalString(partData.callID) ?? row.part_id,
      });

      if (status === 'completed' || status === 'error') {
        toolMessage.toolResult = {
          content: formatToolContent(state.output ?? state.error),
          isError: status === 'error',
        };
      }

      if (toolMessage.toolName === QUESTION_TOOL_NAME) {
        toAskUserQuestionCall(toolMessage, state);
      }

      attachOpenCodeSubagent(toolMessage, state, db, runIsLive);
      normalized.push(toolMessage);
      return normalized;
    }

    if (partType === 'step-finish') {
      normalized.push(createNormalizedMessage({
        id: baseId,
        sessionId,
        timestamp,
        provider: PROVIDER,
        kind: 'stream_end',
      }));
      return normalized;
    }

    if (partType === 'patch' || partType === 'agent') {
      normalized.push(createNormalizedMessage({
        id: baseId,
        sessionId,
        timestamp,
        provider: PROVIDER,
        kind: 'tool_use',
        toolName: partType === 'patch' ? 'Patch' : 'Agent',
        toolInput: partData,
        toolId: row.part_id,
      }));
    }

    return normalized;
  }
}
