import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

import type { IProviderSessions } from '@/shared/interfaces.js';
import type { AnyRecord, FetchHistoryOptions, FetchHistoryResult, NormalizedMessage } from '@/shared/types.js';
import { createNormalizedMessage, generateMessageId, readObjectRecord } from '@/shared/utils.js';

const PROVIDER = 'cursor';

type CursorDbBlob = {
  rowid: number;
  id: string;
  data?: Buffer;
};

type CursorJsonBlob = CursorDbBlob & {
  parsed: AnyRecord;
};

type CursorMessageBlob = {
  id: string;
  sequence: number;
  rowid: number;
  content: AnyRecord;
};

function isInternalCursorText(value: unknown): boolean {
  if (typeof value !== 'string') {
    return false;
  }

  const normalized = value.trim();
  return normalized.startsWith('<user_info>') || normalized.startsWith('<system_reminder>');
}

function isInternalCursorPart(part: unknown): boolean {
  if (!part || typeof part !== 'object') {
    return false;
  }

  const record = part as AnyRecord;
  const type = typeof record.type === 'string' ? record.type : '';
  if (type === 'user_info' || type === 'system_reminder') {
    return true;
  }

  return isInternalCursorText(record.text);
}

function unwrapUserQueryText(value: string, role: 'user' | 'assistant'): string {
  if (role !== 'user') {
    return value;
  }

  const normalized = value.trimStart();
  const openTag = '<user_query>';
  const closeTag = '</user_query>';
  if (!normalized.startsWith(openTag)) {
    return value;
  }

  const afterOpen = normalized.slice(openTag.length);
  const closeIndex = afterOpen.lastIndexOf(closeTag);
  const inner = closeIndex >= 0 ? afterOpen.slice(0, closeIndex) : afterOpen;
  return inner.trim();
}

function normalizeToolId(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
}

function extractCursorToolResultContent(item: AnyRecord): string {
  if (typeof item.result === 'string' && item.result.trim()) {
    return item.result;
  }

  if (typeof item.output === 'string' && item.output.trim()) {
    return item.output;
  }

  if (Array.isArray(item.experimental_content)) {
    const experimentalText = item.experimental_content
      .map((part: unknown) => {
        if (typeof part === 'string') {
          return part;
        }
        if (part && typeof part === 'object') {
          const record = part as AnyRecord;
          if (typeof record.text === 'string') {
            return record.text;
          }
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');

    if (experimentalText.trim()) {
      return experimentalText;
    }
  }

  return typeof item.result === 'string' ? item.result : '';
}

function parseCursorToolInput(rawInput: unknown): unknown {
  if (typeof rawInput !== 'string') {
    return rawInput;
  }

  const trimmed = rawInput.trim();
  if (!trimmed) {
    return rawInput;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return rawInput;
  }
}

function normalizeCursorToolInput(toolName: string, rawInput: unknown): unknown {
  const parsed = parseCursorToolInput(rawInput);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return parsed;
  }

  const input = parsed as AnyRecord;
  const normalized: AnyRecord = { ...input };

  const filePath = input.file_path
    ?? input.filePath
    ?? input.path
    ?? input.file
    ?? input.filename;
  if (typeof filePath === 'string' && filePath.trim()) {
    normalized.file_path = filePath;
  }

  if (toolName === 'Write') {
    const content = input.content
      ?? input.text
      ?? input.value
      ?? input.contents
      ?? input.fileContent
      ?? input.new_string
      ?? input.newString;
    if (typeof content === 'string') {
      normalized.content = content;
    }
  }

  if (toolName === 'Edit') {
    const oldString = input.old_string
      ?? input.oldString
      ?? input.old
      ?? '';
    const newString = input.new_string
      ?? input.newString
      ?? input.new
      ?? input.content
      ?? '';

    if (typeof oldString === 'string') {
      normalized.old_string = oldString;
    }
    if (typeof newString === 'string') {
      normalized.new_string = newString;
    }
  }

  if (toolName === 'ApplyPatch') {
    const patch = input.patch ?? input.diff ?? input.content;
    if (typeof patch === 'string' && !normalized.patch) {
      normalized.patch = patch;
    }
  }

  return normalized;
}

function sanitizeCursorSessionId(sessionId: string): string {
  const normalized = sessionId.trim();
  if (!normalized) {
    throw new Error('Cursor session id is required.');
  }

  if (
    normalized.includes('..')
    || normalized.includes(path.posix.sep)
    || normalized.includes(path.win32.sep)
    || normalized !== path.basename(normalized)
  ) {
    throw new Error(`Invalid cursor session id "${sessionId}".`);
  }

  return normalized;
}

export class CursorSessionsProvider implements IProviderSessions {
  /**
   * Loads Cursor's SQLite blob DAG and returns message blobs in conversation
   * order. Cursor history is stored as content-addressed blobs rather than JSONL.
   */
  private async loadCursorBlobs(sessionId: string, projectPath: string): Promise<CursorMessageBlob[]> {
    // Lazy-import better-sqlite3 so the module doesn't fail if it's unavailable
    const { default: Database } = await import('better-sqlite3');

    const cwdId = crypto.createHash('md5').update(projectPath || process.cwd()).digest('hex');
    const safeSessionId = sanitizeCursorSessionId(sessionId);
    const baseChatsPath = path.join(os.homedir(), '.cursor', 'chats', cwdId);
    const storeDbPath = path.join(baseChatsPath, safeSessionId, 'store.db');
    const resolvedBaseChatsPath = path.resolve(baseChatsPath);
    const resolvedStoreDbPath = path.resolve(storeDbPath);
    const relativeStorePath = path.relative(resolvedBaseChatsPath, resolvedStoreDbPath);
    if (relativeStorePath.startsWith('..') || path.isAbsolute(relativeStorePath)) {
      throw new Error(`Invalid cursor session path for "${sessionId}".`);
    }

    const db = new Database(resolvedStoreDbPath, { readonly: true, fileMustExist: true });

    try {
      const allBlobs = db.prepare<[], CursorDbBlob>('SELECT rowid, id, data FROM blobs').all();

      const blobMap = new Map<string, CursorDbBlob>();
      const parentRefs = new Map<string, string[]>();
      const childRefs = new Map<string, string[]>();
      const jsonBlobs: CursorJsonBlob[] = [];

      for (const blob of allBlobs) {
        blobMap.set(blob.id, blob);

        if (blob.data && blob.data[0] === 0x7B) {
          try {
            const parsed = JSON.parse(blob.data.toString('utf8')) as AnyRecord;
            jsonBlobs.push({ ...blob, parsed });
          } catch {
            // Cursor can include binary or partial blobs; only JSON blobs become messages.
          }
        }
      }

      for (const blob of allBlobs) {
        if (!blob.data || blob.data[0] === 0x7B) {
          continue;
        }

        const parents: string[] = [];
        let i = 0;
        while (i < blob.data.length - 33) {
          if (blob.data[i] === 0x0A && blob.data[i + 1] === 0x20) {
            const parentHash = blob.data.slice(i + 2, i + 34).toString('hex');
            if (blobMap.has(parentHash)) {
              parents.push(parentHash);
            }
            i += 34;
          } else {
            i++;
          }
        }

        if (parents.length > 0) {
          parentRefs.set(blob.id, parents);
          for (const parentId of parents) {
            if (!childRefs.has(parentId)) {
              childRefs.set(parentId, []);
            }
            childRefs.get(parentId)?.push(blob.id);
          }
        }
      }

      const visited = new Set<string>();
      const sorted: CursorDbBlob[] = [];
      const visit = (nodeId: string): void => {
        if (visited.has(nodeId)) {
          return;
        }
        visited.add(nodeId);
        for (const parentId of parentRefs.get(nodeId) || []) {
          visit(parentId);
        }
        const blob = blobMap.get(nodeId);
        if (blob) {
          sorted.push(blob);
        }
      };

      for (const blob of allBlobs) {
        if (!parentRefs.has(blob.id)) {
          visit(blob.id);
        }
      }
      for (const blob of allBlobs) {
        visit(blob.id);
      }

      const messageOrder = new Map<string, number>();
      let orderIndex = 0;
      for (const blob of sorted) {
        if (blob.data && blob.data[0] !== 0x7B) {
          for (const jsonBlob of jsonBlobs) {
            try {
              const idBytes = Buffer.from(jsonBlob.id, 'hex');
              if (blob.data.includes(idBytes) && !messageOrder.has(jsonBlob.id)) {
                messageOrder.set(jsonBlob.id, orderIndex++);
              }
            } catch {
              // Ignore malformed blob ids that cannot be decoded as hex.
            }
          }
        }
      }

      const sortedJsonBlobs = jsonBlobs.sort((a, b) => {
        const aOrder = messageOrder.get(a.id) ?? Number.MAX_SAFE_INTEGER;
        const bOrder = messageOrder.get(b.id) ?? Number.MAX_SAFE_INTEGER;
        return aOrder !== bOrder ? aOrder - bOrder : a.rowid - b.rowid;
      });

      const messages: CursorMessageBlob[] = [];
      for (let idx = 0; idx < sortedJsonBlobs.length; idx++) {
        const blob = sortedJsonBlobs[idx];
        const parsed = blob.parsed;
        const role = parsed?.role || parsed?.message?.role;
        if (role === 'system') {
          continue;
        }
        messages.push({
          id: blob.id,
          sequence: idx + 1,
          rowid: blob.rowid,
          content: parsed,
        });
      }

      return messages;
    } finally {
      db.close();
    }
  }

  /**
   * Normalizes live Cursor CLI NDJSON events. Persisted Cursor history is
   * normalized from SQLite blobs in fetchHistory().
   */
  normalizeMessage(rawMessage: unknown, sessionId: string | null): NormalizedMessage[] {
    const raw = readObjectRecord(rawMessage);
    if (raw?.type === 'assistant' && raw.message?.content?.[0]?.text) {
      return [createNormalizedMessage({
        kind: 'stream_delta',
        content: raw.message.content[0].text,
        sessionId,
        provider: PROVIDER,
      })];
    }

    if (typeof rawMessage === 'string' && rawMessage.trim()) {
      return [createNormalizedMessage({
        kind: 'stream_delta',
        content: rawMessage,
        sessionId,
        provider: PROVIDER,
      })];
    }

    return [];
  }

  /**
   * Fetches and paginates Cursor session history from its project-scoped store.db.
   */
  async fetchHistory(
    sessionId: string,
    options: FetchHistoryOptions = {},
  ): Promise<FetchHistoryResult> {
    const { projectPath = '', limit = null, offset = 0 } = options;

    try {
      const blobs = await this.loadCursorBlobs(sessionId, projectPath);
      const allNormalized = this.normalizeCursorBlobs(blobs, sessionId);
      const renderableMessages = allNormalized.filter((msg) => msg.kind !== 'tool_result');
      const total = renderableMessages.length;

      if (limit !== null) {
        const start = offset;
        const page = limit === 0
          ? []
          : renderableMessages.slice(start, start + limit);
        const hasMore = limit === 0
          ? start < total
          : start + limit < total;
        return {
          messages: page,
          total,
          hasMore,
          offset,
          limit,
        };
      }

      return {
        messages: renderableMessages,
        total,
        hasMore: false,
        offset: 0,
        limit: null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[CursorProvider] Failed to load session ${sessionId}:`, message);
      return { messages: [], total: 0, hasMore: false, offset: 0, limit: null };
    }
  }

  /**
   * Converts Cursor SQLite message blobs into normalized messages and attaches
   * matching tool results to their tool_use entries.
   */
  private normalizeCursorBlobs(blobs: CursorMessageBlob[], sessionId: string | null): NormalizedMessage[] {
    const messages: NormalizedMessage[] = [];
    const toolUseMap = new Map<string, NormalizedMessage>();
    const baseTime = Date.now();

    for (let i = 0; i < blobs.length; i++) {
      const blob = blobs[i];
      const content = blob.content;
      const ts = new Date(baseTime + (blob.sequence ?? i) * 100).toISOString();
      const baseId = blob.id || generateMessageId('cursor');

      try {
        if (!content?.role || !content?.content) {
          if (content?.message?.role && content?.message?.content) {
            if (content.message.role === 'system') {
              continue;
            }
            const role = content.message.role === 'user' ? 'user' : 'assistant';
            let text = '';
            if (Array.isArray(content.message.content)) {
              text = content.message.content
                .map((part: string | AnyRecord) => {
                  if (typeof part === 'string') {
                    if (isInternalCursorText(part)) {
                      return '';
                    }
                    return unwrapUserQueryText(part, role);
                  }
                  if (isInternalCursorPart(part)) {
                    return '';
                  }
                  return unwrapUserQueryText(part?.text || '', role);
                })
                .filter(Boolean)
                .join('\n');
            } else if (typeof content.message.content === 'string') {
              if (!isInternalCursorText(content.message.content)) {
                text = unwrapUserQueryText(content.message.content, role);
              }
            }
            if (text?.trim()) {
              messages.push(createNormalizedMessage({
                id: baseId,
                sessionId,
                timestamp: ts,
                provider: PROVIDER,
                kind: 'text',
                role,
                content: text,
                sequence: blob.sequence,
                rowid: blob.rowid,
              }));
            }
          }
          continue;
        }

        if (content.role === 'system') {
          continue;
        }

        if (content.role === 'tool') {
          const toolItems = Array.isArray(content.content) ? content.content : [];
          for (const item of toolItems) {
            if (item?.type !== 'tool-result') {
              continue;
            }
            const cursorOptions = content.providerOptions?.cursor as AnyRecord | undefined;
            const highLevelToolCallResult = cursorOptions?.highLevelToolCallResult;
            const toolCallId = normalizeToolId(item.toolCallId)
              || normalizeToolId(item.tool_call_id)
              || normalizeToolId(highLevelToolCallResult?.toolCallId)
              || normalizeToolId(highLevelToolCallResult?.tool_call_id)
              || normalizeToolId(content.id)
              || '';
            messages.push(createNormalizedMessage({
              id: `${baseId}_tr`,
              sessionId,
              timestamp: ts,
              provider: PROVIDER,
              kind: 'tool_result',
              toolId: toolCallId,
              content: extractCursorToolResultContent(item),
              isError: Boolean(item.isError || item.is_error),
              toolUseResult: highLevelToolCallResult,
            }));
          }
          continue;
        }

        const role = content.role === 'user' ? 'user' : 'assistant';

        if (Array.isArray(content.content)) {
          for (let partIdx = 0; partIdx < content.content.length; partIdx++) {
            const part = content.content[partIdx];
            if (isInternalCursorPart(part)) {
              continue;
            }

            if (part?.type === 'text' && part?.text) {
              const normalizedPartText = unwrapUserQueryText(part.text, role);
              if (!normalizedPartText) {
                continue;
              }
              messages.push(createNormalizedMessage({
                id: `${baseId}_${partIdx}`,
                sessionId,
                timestamp: ts,
                provider: PROVIDER,
                kind: 'text',
                role,
                content: normalizedPartText,
                sequence: blob.sequence,
                rowid: blob.rowid,
              }));
            } else if (part?.type === 'reasoning' && part?.text) {
              messages.push(createNormalizedMessage({
                id: `${baseId}_${partIdx}`,
                sessionId,
                timestamp: ts,
                provider: PROVIDER,
                kind: 'thinking',
                content: part.text,
              }));
            } else if (part?.type === 'tool-call' || part?.type === 'tool_use') {
              const rawToolName = part.toolName || part.name || 'Unknown Tool';
              const toolName = rawToolName === 'ApplyPatch' ? 'Edit' : rawToolName;
              const toolId = normalizeToolId(part.toolCallId)
                || normalizeToolId(part.tool_call_id)
                || normalizeToolId(part.id)
                || `tool_${i}_${partIdx}`;
              const normalizedToolInput = normalizeCursorToolInput(rawToolName, part.args ?? part.input);
              const message = createNormalizedMessage({
                id: `${baseId}_${partIdx}`,
                sessionId,
                timestamp: ts,
                provider: PROVIDER,
                kind: 'tool_use',
                toolName,
                toolInput: normalizedToolInput,
                toolId,
              });
              messages.push(message);
              toolUseMap.set(toolId, message);
            }
          }
        } else if (
          typeof content.content === 'string'
          && content.content.trim()
          && !isInternalCursorText(content.content)
        ) {
          const normalizedText = unwrapUserQueryText(content.content, role);
          if (!normalizedText) {
            continue;
          }
          messages.push(createNormalizedMessage({
            id: baseId,
            sessionId,
            timestamp: ts,
            provider: PROVIDER,
            kind: 'text',
            role,
            content: normalizedText,
            sequence: blob.sequence,
            rowid: blob.rowid,
          }));
        }
      } catch (error) {
        console.warn('Error normalizing cursor blob:', error);
      }
    }

    for (const msg of messages) {
      if (msg.kind === 'tool_result' && msg.toolId && toolUseMap.has(msg.toolId)) {
        const toolUse = toolUseMap.get(msg.toolId);
        if (toolUse) {
          toolUse.toolResult = {
            content: msg.content,
            isError: msg.isError,
            toolUseResult: msg.toolUseResult,
          };
        }
      }
    }

    messages.sort((a, b) => {
      if (a.sequence !== undefined && b.sequence !== undefined) {
        return a.sequence - b.sequence;
      }
      if (a.rowid !== undefined && b.rowid !== undefined) {
        return a.rowid - b.rowid;
      }
      return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
    });

    return messages;
  }
}
