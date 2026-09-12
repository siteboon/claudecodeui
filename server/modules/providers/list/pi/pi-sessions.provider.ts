import fsSync from 'node:fs';
import path from 'node:path';

import { parseFilesInputTag, parseImagesInputTag } from '@/shared/image-attachments.js';
import type { IProviderSessions } from '@/shared/interfaces.js';
import type { AnyRecord, FetchHistoryOptions, FetchHistoryResult, NormalizedMessage } from '@/shared/types.js';
import {
  createNormalizedMessage,
  generateMessageId,
  getPiSessionDir,
  normalizeProviderTimestamp,
  readObjectRecord,
  readOptionalString,
  sliceTailPage,
} from '@/shared/utils.js';

const PROVIDER = 'pi';

/**
 * Reads one string field verbatim when non-empty.
 *
 * Unlike `readOptionalString` this never trims: streaming deltas and tool
 * output carry significant leading/trailing whitespace (" world", "ls\n"),
 * which a trimmed read would silently corrupt.
 */
const readVerbatimString = (value: unknown): string | undefined => {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
};

/**
 * Joins one tool result's content blocks into the display string every other
 * provider carries on `toolResult.content`. pi sends `[{type:'text',text}]`
 * blocks (probe/sample4.jsonl) but tolerates plain strings.
 */
const joinBlockText = (value: unknown): string => {
  if (typeof value === 'string') {
    return value;
  }

  if (!Array.isArray(value)) {
    return '';
  }

  return value
    .map((block) => readVerbatimString(readObjectRecord(block)?.text) ?? '')
    .filter(Boolean)
    .join('\n');
};

/**
 * Maps pi's cumulative usage counters onto the token-usage shape opencode
 * history returns (`used`/`inputTokens`/`outputTokens`/`breakdown`). Cache
 * reads count as input, matching the pi runtime's token budget. pi's own
 * `totalTokens` is kept alongside so cost-heavy consumers see the raw figure.
 */
const buildPiTokenUsage = (usage: AnyRecord): AnyRecord | undefined => {
  const inputTokens = Number(usage.input ?? 0) + Number(usage.cacheRead ?? 0);
  const outputTokens = Number(usage.output ?? 0);
  const totalTokens = Number(usage.totalTokens ?? 0);
  const used = totalTokens || inputTokens + outputTokens;
  if (used <= 0) {
    return undefined;
  }

  return {
    used,
    inputTokens,
    outputTokens,
    breakdown: {
      input: inputTokens,
      output: outputTokens,
    },
    totalTokens,
  };
};

/**
 * Maps one live `pi -p --mode json` event onto zero or more normalized
 * messages. This is the real body behind the runtime's
 * `context.normalizeMessage` callback (pi-runtime.provider.js).
 *
 * Event → message mapping (verified against probe/*.jsonl, pi 0.85.1):
 * - `message_update` + `text_delta`     → `stream_delta` (content = delta)
 * - `message_update` + `thinking_delta` → `thinking` (content = delta)
 * - `message_update` + `*_start`/`*_end` → [] (they restate what the deltas
 *   already streamed; emitting them would duplicate the block)
 * - `message_update` + `toolcall_*`     → [] (tool activity is carried by the
 *   top-level `tool_execution_*` events instead)
 * - `tool_execution_start`              → `tool_use` (toolName/toolInput/toolId)
 * - `tool_execution_end`                → `tool_result` (toolId + toolResult)
 *   Deliberately NOT folded onto the `tool_use`: pi emits start and end as
 *   separate events, so a standalone `tool_result` keyed by `toolId` is what
 *   the transcript renderer already pairs with its `tool_use` row.
 * - `tool_execution_update`             → [] (partial results duplicate the final one)
 * - `message_end` (role assistant)      → `stream_end`
 * - `message_end` carrying `stopReason: 'error'` plus `errorMessage`
 *                                       → `error` — pi exits 0 even when the
 *   model call failed, so this is the runtime's ONLY error signal. pi echoes
 *   the same failed turn on `message_start`/`turn_end`; `message_end` stays
 *   the single outlet so one failed turn surfaces exactly one error row.
 * - `extension_error`                   → `error` (content = the error field)
 * - `message_start`/user echoes/`turn_*`/`agent_*`/`session`/`model_change`/
 *   `thinking_level_change`/`agent_settled` → []
 *
 * Exported so the runtime tests drive the exact mapping the live stream uses.
 */
export function mapPiEventToMessages(rawEvent: unknown, sessionId: string | null): NormalizedMessage[] {
  const event = readObjectRecord(rawEvent);
  if (!event) {
    return [];
  }

  const type = readOptionalString(event.type);
  const message = readObjectRecord(event.message);
  const timestamp = normalizeProviderTimestamp(event.timestamp ?? message?.timestamp);
  const build = (fields: { kind: NormalizedMessage['kind'] } & Record<string, unknown>): NormalizedMessage => createNormalizedMessage({
    ...fields,
    sessionId,
    timestamp,
    provider: PROVIDER,
  });

  if (type === 'message_update') {
    const update = readObjectRecord(event.assistantMessageEvent);
    const updateType = readOptionalString(update?.type);
    const content = readVerbatimString(update?.delta);

    if (updateType === 'text_delta' && content) {
      return [build({ kind: 'stream_delta', content })];
    }
    if (updateType === 'thinking_delta' && content) {
      return [build({ kind: 'thinking', content })];
    }
    return [];
  }

  if (type === 'tool_execution_start') {
    return [build({
      kind: 'tool_use',
      toolName: readOptionalString(event.toolName) ?? 'Tool',
      toolInput: event.args ?? {},
      toolId: readOptionalString(event.toolCallId) ?? generateMessageId('tool'),
    })];
  }

  if (type === 'tool_execution_end') {
    const toolResult: NonNullable<NormalizedMessage['toolResult']> = {
      content: joinBlockText(readObjectRecord(event.result)?.content ?? event.result),
    };
    // pi reports `isError` on the end event (probe/sample4.jsonl); treat it as
    // optional so an absent field stays undefined rather than a false claim.
    if (event.isError !== undefined) {
      toolResult.isError = event.isError === true;
    }

    return [build({
      kind: 'tool_result',
      toolId: readOptionalString(event.toolCallId),
      toolName: readOptionalString(event.toolName),
      toolResult,
    })];
  }

  if (type === 'message_start' || type === 'message_end' || type === 'turn_end') {
    // Error mapping must win over the stream_end mapping: the assistant
    // message_end of a failed turn carries the error instead of content. The
    // message_start/turn_end echoes of the same failure stay silent so one
    // failed turn surfaces exactly one error row.
    if (type === 'message_end' && readOptionalString(message?.stopReason) === 'error') {
      const errorContent = readOptionalString(message?.errorMessage);
      if (errorContent) {
        return [build({ kind: 'error', content: errorContent, isError: true })];
      }
    }

    if (type === 'message_end' && readOptionalString(message?.role) === 'assistant') {
      return [build({ kind: 'stream_end' })];
    }

    // User/toolResult message echoes and turn bookkeeping emit nothing.
    return [];
  }

  if (type === 'extension_error') {
    return [build({
      kind: 'error',
      content: readOptionalString(event.error) ?? readOptionalString(event.errorMessage) ?? 'Unknown pi error',
      isError: true,
    })];
  }

  // session/agent_*/turn_start/model_change/thinking_level_change/agent_settled
  return [];
}

/**
 * Locates one pi transcript by provider-native session id.
 *
 * pi writes `~/.pi/agent/sessions/<encoded-cwd>/<ISO timestamp>_<uuid>.jsonl`
 * and keeps every session of one working directory flat in that folder, so a
 * recursive `*<id>*.jsonl` match covers both full uuids and the partial ids
 * `pi --session` accepts. Names start with a timestamp, so lexical order is
 * chronological and the last match is the newest.
 */
const findPiSessionTranscript = (sessionId: string): string | null => {
  const normalizedId = sessionId.trim();
  if (
    !normalizedId
    || normalizedId.includes('..')
    || normalizedId.includes('/')
    || normalizedId.includes('\\')
  ) {
    return null;
  }

  const matches: string[] = [];
  const walk = (directory: string): void => {
    let entries: fsSync.Dirent[];
    try {
      entries = fsSync.readdirSync(directory, { withFileTypes: true });
    } catch {
      // A missing pi data directory just means "no sessions yet".
      return;
    }

    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(entryPath);
      } else if (entry.name.endsWith('.jsonl') && entry.name.includes(normalizedId)) {
        matches.push(entryPath);
      }
    }
  };

  walk(getPiSessionDir());
  return matches.sort().at(-1) ?? null;
};

/**
 * Reads a pi JSONL transcript into parsed entries, skipping malformed lines.
 *
 * Exported so the session synchronizer reuses the exact reader (torn last
 * line tolerance included) when indexing the same transcripts into the DB.
 */
export const readPiTranscriptEntries = (transcriptPath: string): AnyRecord[] => {
  const entries: AnyRecord[] = [];
  const lines = fsSync.readFileSync(transcriptPath, 'utf8').split(/\r?\n/);

  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }

    try {
      const entry = readObjectRecord(JSON.parse(line));
      if (entry) {
        entries.push(entry);
      }
    } catch {
      // pi may leave a torn last line while appending; skip it.
    }
  }

  return entries;
};

/**
 * Normalizes one parsed transcript entry into history messages.
 *
 * Only `type: 'message'` entries expand — headers (`session`), model and
 * thinking-level changes, and labels are metadata, not conversation. Within a
 * message entry the role decides the shape:
 * - `user`       → one `text` message, with `<images_input>`/`<files_input>`
 *                  blocks stripped back into images/files fields
 * - `assistant`  → content blocks expand in order: text → `text`,
 *                  thinking → `thinking`, toolCall → `tool_use`
 * - `toolResult` → standalone `tool_result` keyed by its toolCallId
 *
 * Exported so the session synchronizer titles sessions from the same user-text
 * extraction (attachment tags stripped) that history rendering uses.
 */
export const normalizeTranscriptEntry = (entry: AnyRecord, sessionId: string | null): NormalizedMessage[] => {
  if (readOptionalString(entry.type) !== 'message') {
    return [];
  }

  const message = readObjectRecord(entry.message);
  const role = readOptionalString(message?.role);
  const timestamp = normalizeProviderTimestamp(entry.timestamp ?? message?.timestamp);
  const baseId = readOptionalString(entry.id) ?? generateMessageId('pi');
  const blocks = Array.isArray(message?.content) ? message.content : [];

  const normalized: NormalizedMessage[] = [];

  if (role === 'user' || role === 'assistant') {
    const messageRole = role === 'user' ? 'user' : 'assistant';

    // A failed turn is persisted with `stopReason: 'error'` + `errorMessage`
    // on the assistant entry (pi exits 0 regardless); surface it as an error
    // row before whatever partial content the entry carries.
    if (messageRole === 'assistant' && readOptionalString(message?.stopReason) === 'error') {
      const errorContent = readOptionalString(message?.errorMessage);
      if (errorContent) {
        normalized.push(createNormalizedMessage({
          id: `${baseId}_error`,
          sessionId,
          timestamp,
          provider: PROVIDER,
          kind: 'error',
          content: errorContent,
          isError: true,
        }));
      }
    }

    blocks.forEach((block, index) => {
      const record = readObjectRecord(block);
      const blockType = readOptionalString(record?.type);
      const blockId = `${baseId}_${index}`;

      if (blockType === 'text') {
        const rawText = typeof record?.text === 'string' ? record.text : '';
        if (messageRole === 'assistant') {
          if (rawText.trim()) {
            normalized.push(createNormalizedMessage({
              id: blockId,
              sessionId,
              timestamp,
              provider: PROVIDER,
              kind: 'text',
              role: messageRole,
              content: rawText,
            }));
          }
          return;
        }

        // User prompts sent with attachments carry <images_input>/
        // <files_input> blocks appended by the chat composer; strip them for
        // display and surface the paths as images/files.
        const parsedImages = parseImagesInputTag(rawText);
        const parsedFiles = parseFilesInputTag(parsedImages.text);
        if (
          parsedFiles.text.trim()
          || parsedImages.attachments.length > 0
          || parsedFiles.attachments.length > 0
        ) {
          normalized.push(createNormalizedMessage({
            id: blockId,
            sessionId,
            timestamp,
            provider: PROVIDER,
            kind: 'text',
            role: messageRole,
            content: parsedFiles.text,
            images: parsedImages.attachments.length > 0 ? parsedImages.attachments : undefined,
            files: parsedFiles.attachments.length > 0 ? parsedFiles.attachments : undefined,
          }));
        }
        return;
      }

      if (blockType === 'thinking') {
        const content = typeof record?.thinking === 'string' ? record.thinking : '';
        if (content.trim()) {
          normalized.push(createNormalizedMessage({
            id: blockId,
            sessionId,
            timestamp,
            provider: PROVIDER,
            kind: 'thinking',
            content,
          }));
        }
        return;
      }

      if (blockType === 'toolCall') {
        normalized.push(createNormalizedMessage({
          id: blockId,
          sessionId,
          timestamp,
          provider: PROVIDER,
          kind: 'tool_use',
          toolName: readOptionalString(record?.name) ?? 'Tool',
          toolInput: record?.arguments ?? {},
          toolId: readOptionalString(record?.id) ?? blockId,
        }));
      }
    });

    return normalized;
  }

  if (role === 'toolResult') {
    const toolResult: NonNullable<NormalizedMessage['toolResult']> = {
      content: joinBlockText(message?.content),
    };
    if (message?.isError !== undefined) {
      toolResult.isError = message.isError === true;
    }

    normalized.push(createNormalizedMessage({
      id: baseId,
      sessionId,
      timestamp,
      provider: PROVIDER,
      kind: 'tool_result',
      toolName: readOptionalString(message?.toolName),
      toolId: readOptionalString(message?.toolCallId) ?? baseId,
      toolResult,
    }));
  }

  return normalized;
};

export class PiSessionsProvider implements IProviderSessions {
  /**
   * Normalizes live `pi -p --mode json` events into frontend messages.
   */
  normalizeMessage(rawMessage: unknown, sessionId: string | null): NormalizedMessage[] {
    return mapPiEventToMessages(rawMessage, sessionId);
  }

  /**
   * Loads pi history from the session's JSONL transcript under
   * `~/.pi/agent/sessions`.
   */
  async fetchHistory(
    sessionId: string,
    options: FetchHistoryOptions = {},
  ): Promise<FetchHistoryResult> {
    const { limit = null, offset = 0 } = options;
    // pi keys transcript file names by its provider-native session id, not
    // the app-facing id this method is addressed with.
    const providerSessionId = options.providerSessionId ?? sessionId;

    try {
      const transcriptPath = findPiSessionTranscript(providerSessionId);
      if (!transcriptPath) {
        return { messages: [], total: 0, hasMore: false, offset: 0, limit: null };
      }

      const entries = readPiTranscriptEntries(transcriptPath);
      const normalized = entries.flatMap((entry) => normalizeTranscriptEntry(entry, sessionId));

      // pi's per-event usage is cumulative, so the last assistant entry that
      // carries one is the run's final accounting.
      let tokenUsage: AnyRecord | undefined;
      for (const entry of entries) {
        const usage = readObjectRecord(readObjectRecord(entry.message)?.usage);
        if (usage && readOptionalString(readObjectRecord(entry.message)?.role) === 'assistant') {
          tokenUsage = buildPiTokenUsage(usage) ?? tokenUsage;
        }
      }

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
      console.warn(`[PiProvider] Failed to load session ${sessionId}:`, message);
      return { messages: [], total: 0, hasMore: false, offset: 0, limit: null };
    }
  }
}
