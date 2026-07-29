import fsSync from 'node:fs';
import readline from 'node:readline';

import { sessionsDb } from '@/modules/database/index.js';
import type { IProviderSessions } from '@/shared/interfaces.js';
import type { AnyRecord, FetchHistoryOptions, FetchHistoryResult, NormalizedMessage } from '@/shared/types.js';
import { createNormalizedMessage, generateMessageId, readObjectRecord } from '@/shared/utils.js';

const PROVIDER = 'kiro';

/**
 * Kiro persists ACP sessions as JSONL at `~/.kiro/sessions/cli/<id>.jsonl`.
 * Each line is `{version, kind, data}` where kind is one of:
 *   - "Prompt"          : user input
 *   - "AssistantMessage": assistant text and/or tool_use content parts
 *   - "ToolResults"     : tool_result content parts
 *
 * Each `data.content[]` entry is `{kind: "text"|"toolUse"|"toolResult", data}`.
 */

type KiroContentPart = {
  kind: 'text' | 'toolUse' | 'toolResult' | string;
  data: unknown;
};

type KiroJsonlEntry = {
  version?: string;
  kind?: 'Prompt' | 'AssistantMessage' | 'ToolResults' | string;
  data?: {
    message_id?: string;
    content?: KiroContentPart[];
    meta?: { timestamp?: number };
    status?: string;
  };
};

function isContentPart(value: unknown): value is KiroContentPart {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const record = value as AnyRecord;
  return typeof record.kind === 'string';
}

function timestampForEntry(entry: KiroJsonlEntry): string {
  const epochSeconds = entry.data?.meta?.timestamp;
  if (typeof epochSeconds === 'number' && Number.isFinite(epochSeconds)) {
    return new Date(epochSeconds * 1000).toISOString();
  }
  return new Date().toISOString();
}

function extractText(part: KiroContentPart): string {
  if (part.kind !== 'text') {
    return '';
  }
  return typeof part.data === 'string' ? part.data : '';
}

function flattenToolResultContent(content: unknown): { text: string; isError: boolean } {
  if (!Array.isArray(content)) {
    return { text: typeof content === 'string' ? content : '', isError: false };
  }

  let isError = false;
  const text = content
    .map((part) => {
      if (!isContentPart(part)) {
        return '';
      }
      if (part.kind === 'text') {
        return typeof part.data === 'string' ? part.data : '';
      }
      if (part.kind === 'error' || part.kind === 'errorText') {
        isError = true;
        return typeof part.data === 'string' ? part.data : JSON.stringify(part.data);
      }
      return '';
    })
    .filter(Boolean)
    .join('\n');

  return { text, isError };
}

async function readKiroJsonl(filePath: string): Promise<KiroJsonlEntry[]> {
  const entries: KiroJsonlEntry[] = [];
  const fileStream = fsSync.createReadStream(filePath);
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line.trim()) {
      continue;
    }
    try {
      entries.push(JSON.parse(line) as KiroJsonlEntry);
    } catch {
      // Skip malformed lines defensively — Kiro's writer is line-buffered and a
      // crashed turn can leave a partial trailing line.
    }
  }

  return entries;
}

export class KiroSessionsProvider implements IProviderSessions {
  /**
   * Normalizes a Kiro JSONL entry into the shared NormalizedMessage shape.
   *
   * One entry can yield multiple messages (an AssistantMessage with both
   * text and toolUse parts emits text + tool_use, which is why this returns
   * an array).
   */
  private normalizeJsonlEntry(entry: KiroJsonlEntry, sessionId: string | null): NormalizedMessage[] {
    const ts = timestampForEntry(entry);
    const baseId = entry.data?.message_id ?? generateMessageId('kiro');
    const parts = Array.isArray(entry.data?.content) ? entry.data!.content! : [];

    if (entry.kind === 'Prompt') {
      const text = parts.map(extractText).filter(Boolean).join('\n').trim();
      if (!text) {
        return [];
      }
      return [createNormalizedMessage({
        id: baseId,
        sessionId,
        timestamp: ts,
        provider: PROVIDER,
        kind: 'text',
        role: 'user',
        content: text,
      })];
    }

    if (entry.kind === 'AssistantMessage') {
      const messages: NormalizedMessage[] = [];

      // An entry can carry multiple parts of the same kind (e.g. two text
      // chunks, or text + toolUse + text). The part index disambiguates so the
      // generated id is unique even when toolUseId or baseId would otherwise
      // collide across parts.
      for (const [partIndex, part] of parts.entries()) {
        if (!isContentPart(part)) {
          continue;
        }

        if (part.kind === 'text') {
          const text = typeof part.data === 'string' ? part.data : '';
          if (text.trim()) {
            messages.push(createNormalizedMessage({
              id: `${baseId}_text_${partIndex}`,
              sessionId,
              timestamp: ts,
              provider: PROVIDER,
              kind: 'text',
              role: 'assistant',
              content: text,
            }));
          }
          continue;
        }

        if (part.kind === 'toolUse') {
          const data = readObjectRecord(part.data) ?? {};
          const toolUseId = typeof data.toolUseId === 'string' ? data.toolUseId : `${baseId}_tool_${partIndex}`;
          const toolName = typeof data.name === 'string' ? data.name : 'Unknown';
          messages.push(createNormalizedMessage({
            id: toolUseId,
            sessionId,
            timestamp: ts,
            provider: PROVIDER,
            kind: 'tool_use',
            toolName,
            toolInput: data.input,
            toolId: toolUseId,
          }));
        }
      }

      return messages;
    }

    if (entry.kind === 'ToolResults') {
      const messages: NormalizedMessage[] = [];
      // Kiro sets `data.status` to "success" or "error" at the entry level;
      // the per-content-part `error`/`errorText` kinds (handled in
      // `flattenToolResultContent`) are a fallback for older event versions.
      const entryStatus = typeof entry.data?.status === 'string' ? entry.data!.status : null;
      const entryIsError = entryStatus !== null && entryStatus !== 'success';

      for (const [partIndex, part] of parts.entries()) {
        if (!isContentPart(part) || part.kind !== 'toolResult') {
          continue;
        }
        const data = readObjectRecord(part.data) ?? {};
        const toolUseId = typeof data.toolUseId === 'string' ? data.toolUseId : '';
        const { text, isError: contentIsError } = flattenToolResultContent(data.content);
        // Two tool_result parts for the same tool would otherwise share an id.
        // Use the part index as the disambiguator to keep keyed React render
        // and message-association lookups stable.
        messages.push(createNormalizedMessage({
          id: `${toolUseId || baseId}_result_${partIndex}`,
          sessionId,
          timestamp: ts,
          provider: PROVIDER,
          kind: 'tool_result',
          toolId: toolUseId,
          content: text,
          isError: entryIsError || contentIsError,
        }));
      }

      return messages;
    }

    return [];
  }

  /**
   * Normalizes either a Kiro JSONL history entry or a transformed live ACP
   * `session/update` notification (forwarded by `server/kiro-cli.js`).
   */
  normalizeMessage(rawMessage: unknown, sessionId: string | null): NormalizedMessage[] {
    const raw = readObjectRecord(rawMessage);
    if (!raw) {
      return [];
    }

    if (typeof raw.kind === 'string' && raw.data && typeof raw.data === 'object') {
      return this.normalizeJsonlEntry(raw as KiroJsonlEntry, sessionId);
    }

    // Live ACP `session/update` notifications are pre-normalized by the runtime
    // module (`server/kiro-cli.js`). Anything that reaches this method without
    // the `{kind, data}` JSONL shape is treated as already-normalized.
    if (typeof raw.kind === 'string' && typeof raw.provider === 'string') {
      return [raw as NormalizedMessage];
    }

    return [];
  }

  /**
   * Loads Kiro JSONL session history off disk.
   */
  async fetchHistory(
    sessionId: string,
    options: FetchHistoryOptions = {},
  ): Promise<FetchHistoryResult> {
    const { limit = null, offset = 0 } = options;

    let entries: KiroJsonlEntry[];
    try {
      const sessionFilePath = sessionsDb.getSessionById(sessionId)?.jsonl_path;
      if (!sessionFilePath) {
        return { messages: [], total: 0, hasMore: false, offset: 0, limit: null };
      }
      entries = await readKiroJsonl(sessionFilePath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[KiroProvider] Failed to load session ${sessionId}:`, message);
      return { messages: [], total: 0, hasMore: false, offset: 0, limit: null };
    }

    const normalized: NormalizedMessage[] = [];
    for (const entry of entries) {
      normalized.push(...this.normalizeJsonlEntry(entry, sessionId));
    }

    // Backfill tool_result content onto matching tool_use messages so the UI
    // can render the request/response pair as one card. Same shape as Codex's
    // pairing pass (codex-sessions.provider.ts:540-553).
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

    const totalNormalized = normalized.length;
    let total = 0;
    for (const msg of normalized) {
      if (msg.kind !== 'tool_result') {
        total += 1;
      }
    }
    const normalizedOffset = Math.max(0, offset);
    const normalizedLimit = limit === null ? null : Math.max(0, limit);
    const messages = normalizedLimit === null
      ? normalized
      : normalized.slice(
          Math.max(0, totalNormalized - normalizedOffset - normalizedLimit),
          Math.max(0, totalNormalized - normalizedOffset),
        );
    const hasMore = normalizedLimit === null
      ? false
      : Math.max(0, totalNormalized - normalizedOffset - normalizedLimit) > 0;

    return {
      messages,
      total,
      hasMore,
      offset: normalizedOffset,
      limit: normalizedLimit,
    };
  }
}
