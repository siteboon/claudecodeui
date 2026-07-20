import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

import { sessionsDb } from '@/modules/database/index.js';
import { parseImagesInputTag } from '@/shared/image-attachments.js';
import type { IProviderSessions } from '@/shared/interfaces.js';
import type { AnyRecord, FetchHistoryOptions, FetchHistoryResult, NormalizedMessage } from '@/shared/types.js';
import {
  createNormalizedMessage,
  generateMessageId,
  readObjectRecord,
  sanitizeLeafDirectoryName,
  sliceTailPage,
} from '@/shared/utils.js';

import { extractAgentIdFromToolResult } from './utils/cursor-subagent.js';

const PROVIDER = 'cursor';

type CursorDbBlob = {
  rowid: number;
  id: string;
  data?: Buffer;
};

type CursorJsonBlob = CursorDbBlob & {
  parsed: AnyRecord;
};

export type CursorMessageBlob = {
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

  // Cursor wraps user turns as `<timestamp>…</timestamp>\n<user_query>…</user_query>`.
  // Show only the `<user_query>` content, trimmed so there are no blank lines
  // at the top/bottom and the `<timestamp>` prefix is dropped entirely.
  const openTag = '<user_query>';
  const closeTag = '</user_query>';
  const openIndex = value.indexOf(openTag);
  if (openIndex >= 0) {
    const afterOpen = value.slice(openIndex + openTag.length);
    const closeIndex = afterOpen.lastIndexOf(closeTag);
    const inner = closeIndex >= 0 ? afterOpen.slice(0, closeIndex) : afterOpen;
    return inner.trim();
  }

  // No `<user_query>` wrapper: still strip a leading `<timestamp>…</timestamp>`.
  return value.replace(/^\s*<timestamp>[\s\S]*?<\/timestamp>\s*/, '').trim();
}

/**
 * Unwraps one user-authored text payload and splits off the `<images_input>`
 * attachment block appended by the chat composer. Assistant text passes
 * through untouched.
 */
function extractUserTextAndImages(
  value: string,
  role: 'user' | 'assistant',
): { text: string; images?: Array<{ path: string; name?: string }> } {
  const unwrapped = unwrapUserQueryText(value, role);
  if (role !== 'user') {
    return { text: unwrapped };
  }

  const { text, attachments } = parseImagesInputTag(unwrapped);
  return {
    text,
    images: attachments.length > 0 ? attachments : undefined,
  };
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

export class CursorSessionsProvider implements IProviderSessions {
  /**
   * Loads Cursor's SQLite blob DAG and returns message blobs in conversation
   * order. Cursor history is stored as content-addressed blobs rather than JSONL.
   */
  private async loadCursorBlobs(sessionId: string, projectPath: string): Promise<CursorMessageBlob[]> {
    // Lazy-import better-sqlite3 so the module doesn't fail if it's unavailable
    const { default: Database } = await import('better-sqlite3');

    const cwdId = crypto.createHash('md5').update(projectPath || process.cwd()).digest('hex');
    const safeSessionId = sanitizeLeafDirectoryName(sessionId, 'cursor session id');
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
   *
   * Pagination follows the shared tail contract (`sliceTailPage`): offset 0 is
   * the most recent page, matching every other provider.
   */
  async fetchHistory(
    sessionId: string,
    options: FetchHistoryOptions = {},
  ): Promise<FetchHistoryResult> {
    const { projectPath = '', limit = null, offset = 0 } = options;
    // The store.db folder on disk is named after the provider-native id, not
    // the app-facing session id this method is addressed with.
    const providerSessionId = options.providerSessionId ?? sessionId;

    try {
      let allNormalized: NormalizedMessage[];
      try {
        const blobs = await this.loadCursorBlobs(providerSessionId, projectPath);
        allNormalized = this.normalizeCursorBlobs(blobs, sessionId);
      } catch (storeError) {
        // Subagent sessions usually only have agent-transcripts JSONL, no store.db.
        allNormalized = await this.loadCursorJsonlHistory(sessionId, providerSessionId);
        if (allNormalized.length === 0) {
          throw storeError;
        }
      }

      await this.enrichTaskSubagentLinks(allNormalized, sessionId);
      const renderableMessages = allNormalized.filter((msg) => msg.kind !== 'tool_result');
      const total = renderableMessages.length;
      const { page, hasMore } = sliceTailPage(renderableMessages, limit, offset);

      return {
        messages: page,
        total,
        hasMore,
        offset,
        limit,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[CursorProvider] Failed to load session ${sessionId}:`, message);
      return { messages: [], total: 0, hasMore: false, offset: 0, limit: null };
    }
  }

  /**
   * Attaches Cursor Task → subagent session links (and optional tool history)
   * so the parent chat can open the subagent transcript.
   */
  private async enrichTaskSubagentLinks(
    messages: NormalizedMessage[],
    parentSessionId: string | null,
  ): Promise<void> {
    for (const message of messages) {
      if (message.kind !== 'tool_use' || message.toolName !== 'Task') {
        continue;
      }

      const agentId = extractAgentIdFromToolResult(message.toolResult)
        ?? extractAgentIdFromToolResult(message.toolResult?.toolUseResult);
      if (!agentId) {
        continue;
      }

      message.subagentSessionId = agentId;
      if (parentSessionId) {
        sessionsDb.markSessionAsSubagent(agentId, parentSessionId);
      }

      const tools = await this.loadSubagentToolsFromJsonl(agentId);
      if (tools.length > 0) {
        message.subagentTools = tools;
      }
    }
  }

  /**
   * Loads tool_use entries from a Cursor agent-transcripts JSONL file.
   */
  private async loadSubagentToolsFromJsonl(agentId: string): Promise<AnyRecord[]> {
    const row = sessionsDb.getSessionById(agentId)
      ?? sessionsDb.getSessionByProviderSessionId(agentId);
    const jsonlPath = row?.jsonl_path;
    if (!jsonlPath) {
      return [];
    }

    const tools: AnyRecord[] = [];
    try {
      const fileStream = fs.createReadStream(jsonlPath, { encoding: 'utf8' });
      const lineReader = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
      for await (const line of lineReader) {
        if (!line.trim()) {
          continue;
        }
        try {
          const entry = JSON.parse(line) as AnyRecord;
          const content = entry.message?.content;
          if (!Array.isArray(content)) {
            continue;
          }
          for (const part of content) {
            if (part?.type === 'tool_use' && part?.name) {
              tools.push({
                toolId: part.id || `${agentId}_${tools.length}`,
                toolName: part.name,
                toolInput: part.input,
                timestamp: entry.timestamp,
              });
            }
          }
        } catch {
          // Skip malformed JSONL lines.
        }
      }
    } catch {
      return [];
    }

    return tools;
  }

  /**
   * Fallback history reader for Cursor sessions that only have agent-transcripts
   * JSONL (typical for Task/subagent runs without a chats/<hash>/<id>/store.db).
   */
  private async loadCursorJsonlHistory(
    sessionId: string,
    providerSessionId: string,
  ): Promise<NormalizedMessage[]> {
    const row = sessionsDb.getSessionById(sessionId)
      ?? sessionsDb.getSessionByProviderSessionId(providerSessionId);
    const jsonlPath = row?.jsonl_path;
    if (!jsonlPath) {
      return [];
    }

    try {
      await fsp.access(jsonlPath);
    } catch {
      return [];
    }

    const messages: NormalizedMessage[] = [];
    const baseTime = Date.now();
    let sequence = 0;

    try {
      const fileStream = fs.createReadStream(jsonlPath, { encoding: 'utf8' });
      const lineReader = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
      for await (const line of lineReader) {
        if (!line.trim()) {
          continue;
        }
        try {
          const entry = JSON.parse(line) as AnyRecord;
          const roleRaw = entry.role || entry.message?.role;
          if (roleRaw !== 'user' && roleRaw !== 'assistant') {
            continue;
          }
          const role = roleRaw === 'user' ? 'user' : 'assistant';
          const content = entry.message?.content ?? entry.content;
          const ts = typeof entry.timestamp === 'string'
            ? entry.timestamp
            : new Date(baseTime + sequence * 100).toISOString();

          if (Array.isArray(content)) {
            for (let partIdx = 0; partIdx < content.length; partIdx++) {
              const part = content[partIdx] as AnyRecord;
              if (part?.type === 'text' && typeof part.text === 'string') {
                const { text } = extractUserTextAndImages(part.text, role);
                if (!text.trim()) {
                  continue;
                }
                sequence += 1;
                messages.push(createNormalizedMessage({
                  id: `${providerSessionId}_${sequence}`,
                  sessionId,
                  timestamp: ts,
                  provider: PROVIDER,
                  kind: 'text',
                  role,
                  content: text,
                  sequence,
                }));
              } else if (part?.type === 'tool_use' && part?.name) {
                sequence += 1;
                messages.push(createNormalizedMessage({
                  id: `${providerSessionId}_${sequence}`,
                  sessionId,
                  timestamp: ts,
                  provider: PROVIDER,
                  kind: 'tool_use',
                  toolName: part.name === 'ApplyPatch' ? 'Edit' : part.name,
                  toolInput: normalizeCursorToolInput(part.name, part.input),
                  toolId: typeof part.id === 'string' ? part.id : `tool_${sequence}`,
                  sequence,
                }));
              }
            }
          } else if (typeof content === 'string' && content.trim()) {
            const { text } = extractUserTextAndImages(content, role);
            if (!text.trim()) {
              continue;
            }
            sequence += 1;
            messages.push(createNormalizedMessage({
              id: `${providerSessionId}_${sequence}`,
              sessionId,
              timestamp: ts,
              provider: PROVIDER,
              kind: 'text',
              role,
              content: text,
              sequence,
            }));
          }
        } catch {
          // Skip malformed lines.
        }
      }
    } catch {
      return [];
    }

    return messages;
  }

  /**
   * Converts Cursor SQLite message blobs into normalized messages and attaches
   * matching tool results to their tool_use entries.
   *
   * Public so tests can drive history normalization with synthetic blobs
   * without needing a real Cursor store.db.
   */
  normalizeCursorBlobs(blobs: CursorMessageBlob[], sessionId: string | null): NormalizedMessage[] {
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
            const { text: cleanText, images } = role === 'user'
              ? (() => {
                const parsed = parseImagesInputTag(text);
                return {
                  text: parsed.text,
                  images: parsed.attachments.length > 0 ? parsed.attachments : undefined,
                };
              })()
              : { text, images: undefined };
            if (cleanText?.trim() || images) {
              messages.push(createNormalizedMessage({
                id: baseId,
                sessionId,
                timestamp: ts,
                provider: PROVIDER,
                kind: 'text',
                role,
                content: cleanText,
                images,
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
              const { text: normalizedPartText, images } = extractUserTextAndImages(part.text, role);
              if (!normalizedPartText && !images) {
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
                images,
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
          const { text: normalizedText, images } = extractUserTextAndImages(content.content, role);
          if (!normalizedText && !images) {
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
            images,
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
