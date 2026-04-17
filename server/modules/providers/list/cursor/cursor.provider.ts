import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

import { AbstractProvider } from '@/modules/providers/shared/base/abstract.provider.js';
import { CursorMcpProvider } from '@/modules/providers/list/cursor/cursor-mcp.provider.js';
import type { FetchHistoryOptions, FetchHistoryResult, NormalizedMessage } from '@/shared/types.js';
import { createNormalizedMessage, generateMessageId, readObjectRecord } from '@/shared/utils.js';

const PROVIDER = 'cursor';

type RawProviderMessage = Record<string, any>;

type CursorDbBlob = {
  rowid: number;
  id: string;
  data?: Buffer;
};

type CursorJsonBlob = CursorDbBlob & {
  parsed: RawProviderMessage;
};

type CursorMessageBlob = {
  id: string;
  sequence: number;
  rowid: number;
  content: RawProviderMessage;
};

function readRawProviderMessage(raw: unknown): RawProviderMessage | null {
  return readObjectRecord(raw) as RawProviderMessage | null;
}

export class CursorProvider extends AbstractProvider {
  readonly mcp = new CursorMcpProvider();

  constructor() {
    super('cursor');
  }

  /**
   * Loads Cursor's SQLite blob DAG and returns message blobs in conversation
   * order. Cursor history is stored as content-addressed blobs rather than JSONL.
   */
  private async loadCursorBlobs(sessionId: string, projectPath: string): Promise<CursorMessageBlob[]> {
    const sqlite3Module = await import('sqlite3');
    const sqlite3 = sqlite3Module.default;
    const { open } = await import('sqlite');

    const cwdId = crypto.createHash('md5').update(projectPath || process.cwd()).digest('hex');
    const storeDbPath = path.join(os.homedir(), '.cursor', 'chats', cwdId, sessionId, 'store.db');

    const db = await open({
      filename: storeDbPath,
      driver: sqlite3.Database,
      mode: sqlite3.OPEN_READONLY,
    });

    try {
      const allBlobs = await db.all('SELECT rowid, id, data FROM blobs') as CursorDbBlob[];

      const blobMap = new Map<string, CursorDbBlob>();
      const parentRefs = new Map<string, string[]>();
      const childRefs = new Map<string, string[]>();
      const jsonBlobs: CursorJsonBlob[] = [];

      for (const blob of allBlobs) {
        blobMap.set(blob.id, blob);

        if (blob.data && blob.data[0] === 0x7B) {
          try {
            const parsed = JSON.parse(blob.data.toString('utf8')) as RawProviderMessage;
            jsonBlobs.push({ ...blob, parsed });
          } catch {
            // Cursor can include binary or partial blobs; only JSON blobs become messages.
          }
        } else if (blob.data) {
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
      await db.close();
    }
  }

  /**
   * Normalizes live Cursor CLI NDJSON events. Persisted Cursor history is
   * normalized from SQLite blobs in fetchHistory().
   */
  normalizeMessage(rawMessage: unknown, sessionId: string | null): NormalizedMessage[] {
    const raw = readRawProviderMessage(rawMessage);
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

      if (limit !== null && limit > 0) {
        const start = offset;
        const page = allNormalized.slice(start, start + limit);
        return {
          messages: page,
          total: allNormalized.length,
          hasMore: start + limit < allNormalized.length,
          offset,
          limit,
        };
      }

      return {
        messages: allNormalized,
        total: allNormalized.length,
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
                .map((part: string | RawProviderMessage) => typeof part === 'string' ? part : part?.text || '')
                .filter(Boolean)
                .join('\n');
            } else if (typeof content.message.content === 'string') {
              text = content.message.content;
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
            const toolCallId = item.toolCallId || content.id;
            messages.push(createNormalizedMessage({
              id: `${baseId}_tr`,
              sessionId,
              timestamp: ts,
              provider: PROVIDER,
              kind: 'tool_result',
              toolId: toolCallId,
              content: item.result || '',
              isError: false,
            }));
          }
          continue;
        }

        const role = content.role === 'user' ? 'user' : 'assistant';

        if (Array.isArray(content.content)) {
          for (let partIdx = 0; partIdx < content.content.length; partIdx++) {
            const part = content.content[partIdx];

            if (part?.type === 'text' && part?.text) {
              messages.push(createNormalizedMessage({
                id: `${baseId}_${partIdx}`,
                sessionId,
                timestamp: ts,
                provider: PROVIDER,
                kind: 'text',
                role,
                content: part.text,
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
              const toolId = part.toolCallId || part.id || `tool_${i}_${partIdx}`;
              const message = createNormalizedMessage({
                id: `${baseId}_${partIdx}`,
                sessionId,
                timestamp: ts,
                provider: PROVIDER,
                kind: 'tool_use',
                toolName,
                toolInput: part.args || part.input,
                toolId,
              });
              messages.push(message);
              toolUseMap.set(toolId, message);
            }
          }
        } else if (typeof content.content === 'string' && content.content.trim()) {
          messages.push(createNormalizedMessage({
            id: baseId,
            sessionId,
            timestamp: ts,
            provider: PROVIDER,
            kind: 'text',
            role,
            content: content.content,
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
