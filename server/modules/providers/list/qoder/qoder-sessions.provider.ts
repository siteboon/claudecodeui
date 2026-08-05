import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';

import type { IProviderSessions } from '@/shared/interfaces.js';
import type { AnyRecord, FetchHistoryOptions, FetchHistoryResult, NormalizedMessage } from '@/shared/types.js';
import { parseFilesInputTag } from '@/shared/image-attachments.js';
import {
  createNormalizedMessage,
  generateMessageId,
  getQoderProjectsDir,
  readObjectRecord,
  sliceTailPage,
} from '@/shared/utils.js';
import { sessionsDb } from '@/modules/database/index.js';

const PROVIDER = 'qoder';

type QoderToolResult = {
  content: unknown;
  isError: boolean;
};

const QODER_META_ROW_TYPES = new Set([
  'workspace-directories',
  'runtime-config',
  'ai-title',
  'last-prompt',
  'system',
]);

/**
 * Resolves the on-disk transcript for a session.
 *
 * Qoder persists every conversation to
 * `~/.qoder/projects/<cwd with '/' → '-'>/<sessionId>.jsonl`; the app-side
 * sessions row records the exact path in `jsonl_path` when the synchronizer
 * imported the session. Falling back to a recursive scan keeps history working
 * for sessions that were never imported (e.g. created live via the runtime).
 */
async function resolveQoderJsonlPath(
  sessionId: string,
  providerSessionId: string,
): Promise<string | null> {
  const known = sessionsDb.getSessionById(sessionId)?.jsonl_path;
  if (known && fs.existsSync(known)) {
    return known;
  }

  const projectsDir = getQoderProjectsDir();
  if (!fs.existsSync(projectsDir)) {
    return null;
  }

  const targetFile = `${providerSessionId}.jsonl`;
  const queue = [projectsDir];
  let guard = 0;
  while (queue.length > 0 && guard < 2000) {
    guard += 1;
    const dir = queue.shift();
    if (!dir) {
      continue;
    }

    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
      } else if (entry.name === targetFile) {
        return fullPath;
      }
    }
  }

  return null;
}

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
 * Normalizes one Qoder stream-json event (live) or JSONL entry (history).
 *
 * The on-disk format is Claude-compatible: `user` / `assistant` rows carry a
 * `message` with a `content` array of `text` / `thinking` / `tool_use` /
 * `tool_result` parts, plus a `usage` object on assistant rows. Internal meta
 * rows (`workspace-directories`, `runtime-config`, `ai-title`, ...) have no
 * message role and are dropped naturally.
 */
export class QoderSessionsProvider implements IProviderSessions {
  normalizeMessage(rawMessage: unknown, sessionId: string | null): NormalizedMessage[] {
    const raw = readObjectRecord(rawMessage);
    if (!raw) {
      return [];
    }

    const ts = typeof raw.timestamp === 'string' ? raw.timestamp : new Date().toISOString();
    const baseId = typeof raw.uuid === 'string' ? raw.uuid : generateMessageId('qoder');
    const messages: NormalizedMessage[] = [];

    // Live stream events. `session_created` is intentionally NOT emitted here:
    // the qoder runtime (readQoderSessionId) is the single owner of that event
    // and reads the provider session id under every spelling (sessionID /
    // sessionId / session_id). Emitting it here too would double-notify the
    // client. The init control row carries no renderable content.
    if (raw.type === 'system' && raw.subtype === 'init') {
      return messages;
    }

    if (raw.type === 'content_block_delta' && raw.delta?.text) {
      return [createNormalizedMessage({
        kind: 'stream_delta',
        content: raw.delta.text,
        sessionId,
        provider: PROVIDER,
      })];
    }
    if (raw.type === 'content_block_stop') {
      return [createNormalizedMessage({ kind: 'stream_end', sessionId, provider: PROVIDER })];
    }
    if (raw.type === 'result') {
      // qodercli 1.1.13 emits the final answer as a plain string
      // (`{"type":"result","subtype":"success","result":"OK"}`). Claude-style
      // payloads carry a `content` part array instead, so both shapes are read:
      // dropping either one loses the entire answer while the run still reports
      // success.
      if (typeof raw.result === 'string' && raw.result.trim()) {
        return [createNormalizedMessage({
          id: `${baseId}_result`,
          sessionId,
          timestamp: ts,
          provider: PROVIDER,
          kind: 'text',
          role: 'assistant',
          content: raw.result,
        })];
      }

      if (Array.isArray(raw.result?.content)) {
        for (const part of raw.result.content) {
          if (part?.type === 'text' && part.text) {
            messages.push(createNormalizedMessage({
              id: `${baseId}_result`,
              sessionId,
              timestamp: ts,
              provider: PROVIDER,
              kind: 'text',
              role: 'assistant',
              content: part.text,
            }));
          }
        }
      }

      return messages;
    }

    const role = raw.message?.role;

    if (role === 'user' && raw.message?.content && raw.isMeta !== true) {
      if (Array.isArray(raw.message.content)) {
        let imagesAttached = false;
        let filesAttached = false;

        for (let partIndex = 0; partIndex < raw.message.content.length; partIndex++) {
          const part = raw.message.content[partIndex];
          if (!part || typeof part !== 'object') {
            continue;
          }
          if (part.type === 'tool_result') {
            messages.push(createNormalizedMessage({
              id: `${baseId}_tr_${part.tool_use_id ?? partIndex}`,
              sessionId,
              timestamp: ts,
              provider: PROVIDER,
              kind: 'tool_result',
              toolId: part.tool_use_id,
              content: formatToolContent(part.content),
              isError: Boolean(part.is_error),
            }));
          } else if (part.type === 'text' && part.text) {
            const parsedFiles = parseFilesInputTag(part.text);
            if (parsedFiles.text.trim() || parsedFiles.attachments.length > 0) {
              messages.push(createNormalizedMessage({
                id: `${baseId}_text_${partIndex}`,
                sessionId,
                timestamp: ts,
                provider: PROVIDER,
                kind: 'text',
                role: 'user',
                content: parsedFiles.text,
                files: !filesAttached && parsedFiles.attachments.length > 0
                  ? parsedFiles.attachments
                  : undefined,
              }));
              filesAttached = filesAttached || parsedFiles.attachments.length > 0;
            }
          }
        }

        if (messages.length === 0) {
          const textParts = raw.message.content
            .filter((part: AnyRecord) => part?.type === 'text' && typeof part.text === 'string')
            .map((part: AnyRecord) => part.text)
            .join('\n');
          if (textParts.trim()) {
            messages.push(createNormalizedMessage({
              id: `${baseId}_text`,
              sessionId,
              timestamp: ts,
              provider: PROVIDER,
              kind: 'text',
              role: 'user',
              content: textParts,
            }));
          }
        }
        void imagesAttached;
      } else if (typeof raw.message.content === 'string') {
        const parsedFiles = parseFilesInputTag(raw.message.content);
        if (parsedFiles.text.trim() || parsedFiles.attachments.length > 0) {
          messages.push(createNormalizedMessage({
            id: baseId,
            sessionId,
            timestamp: ts,
            provider: PROVIDER,
            kind: 'text',
            role: 'user',
            content: parsedFiles.text,
            files: parsedFiles.attachments.length > 0 ? parsedFiles.attachments : undefined,
          }));
        }
      }
      return messages;
    }

    if (role === 'assistant' && raw.message?.content) {
      if (Array.isArray(raw.message.content)) {
        let partIndex = 0;
        for (const part of raw.message.content) {
          if (!part || typeof part !== 'object') {
            partIndex += 1;
            continue;
          }
          if (part.type === 'text' && part.text) {
            messages.push(createNormalizedMessage({
              id: `${baseId}_${partIndex}`,
              sessionId,
              timestamp: ts,
              provider: PROVIDER,
              kind: 'text',
              role: 'assistant',
              content: part.text,
            }));
          } else if (part.type === 'tool_use') {
            messages.push(createNormalizedMessage({
              id: `${baseId}_${partIndex}`,
              sessionId,
              timestamp: ts,
              provider: PROVIDER,
              kind: 'tool_use',
              toolName: part.name ?? 'Tool',
              toolInput: part.input ?? {},
              toolId: part.id ?? `${baseId}_tool_${partIndex}`,
            }));
          } else if (part.type === 'thinking' && part.thinking) {
            messages.push(createNormalizedMessage({
              id: `${baseId}_${partIndex}`,
              sessionId,
              timestamp: ts,
              provider: PROVIDER,
              kind: 'thinking',
              content: part.thinking,
            }));
          }
          partIndex += 1;
        }
      } else if (typeof raw.message.content === 'string' && raw.message.content.trim()) {
        messages.push(createNormalizedMessage({
          id: baseId,
          sessionId,
          timestamp: ts,
          provider: PROVIDER,
          kind: 'text',
          role: 'assistant',
          content: raw.message.content,
        }));
      }
      return messages;
    }

    if (raw.type === 'tool_use' && raw.toolName) {
      messages.push(createNormalizedMessage({
        id: baseId,
        sessionId,
        timestamp: ts,
        provider: PROVIDER,
        kind: 'tool_use',
        toolName: raw.toolName,
        toolInput: raw.toolInput ?? {},
        toolId: raw.toolCallId ?? baseId,
      }));
      return messages;
    }

    if (raw.type === 'error') {
      return [createNormalizedMessage({
        id: baseId,
        sessionId,
        timestamp: ts,
        provider: PROVIDER,
        kind: 'error',
        content: raw.error?.message ?? raw.error ?? String(raw.message ?? 'Qoder error'),
      })];
    }

    void QODER_META_ROW_TYPES;
    return messages;
  }

  /**
   * Loads Qoder JSONL history for a session and returns normalized messages,
   * mirroring Claude's pagination semantics (tool_results ride on their
   * tool_use parent, so they do not count toward `total`).
   */
  async fetchHistory(
    sessionId: string,
    options: FetchHistoryOptions = {},
  ): Promise<FetchHistoryResult> {
    const { limit = null, offset = 0 } = options;
    const providerSessionId = options.providerSessionId ?? sessionId;

    let jsonlPath: string | null = null;
    try {
      jsonlPath = await resolveQoderJsonlPath(sessionId, providerSessionId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[QoderProvider] Failed to resolve transcript for session ${sessionId}:`, message);
      return { messages: [], total: 0, hasMore: false, offset: 0, limit: null };
    }

    if (!jsonlPath) {
      return { messages: [], total: 0, hasMore: false, offset: 0, limit: null };
    }

    const rawMessages: AnyRecord[] = [];
    try {
      const fileStream = fs.createReadStream(jsonlPath);
      const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
      for await (const line of rl) {
        if (!line.trim()) {
          continue;
        }
        try {
          const entry = JSON.parse(line) as AnyRecord;
          if (entry?.sessionId === providerSessionId) {
            rawMessages.push(entry);
          }
        } catch {
          // Skip malformed JSONL lines that can happen during concurrent writes.
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[QoderProvider] Failed to load session ${sessionId}:`, message);
      return { messages: [], total: 0, hasMore: false, offset: 0, limit: null };
    }

    rawMessages.sort(
      (a, b) => new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime(),
    );

    // First pass: collect tool results so assistant tool_use parts can carry
    // their result inline (Claude JSONL semantics).
    const toolResultMap = new Map<string, QoderToolResult>();
    for (const raw of rawMessages) {
      if (raw.message?.role === 'user' && Array.isArray(raw.message?.content)) {
        for (const part of raw.message.content) {
          if (part?.type === 'tool_result' && part.tool_use_id) {
            toolResultMap.set(part.tool_use_id, {
              content: part.content,
              isError: Boolean(part.is_error),
            });
          }
        }
      }
    }

    const normalized: NormalizedMessage[] = [];
    for (const raw of rawMessages) {
      normalized.push(...this.normalizeMessage(raw, sessionId));
    }

    for (const msg of normalized) {
      if (msg.kind === 'tool_use' && msg.toolId && toolResultMap.has(msg.toolId)) {
        const toolResult = toolResultMap.get(msg.toolId);
        if (!toolResult) {
          continue;
        }
        msg.toolResult = {
          content: formatToolContent(toolResult.content),
          isError: toolResult.isError,
        };
      }
    }

    // Token usage: aggregate the usage objects on assistant rows.
    let inputTokens = 0;
    let outputTokens = 0;
    let cacheReadTokens = 0;
    let cacheCreationTokens = 0;
    for (const raw of rawMessages) {
      if (raw.type !== 'assistant' || raw.message?.role !== 'assistant') {
        continue;
      }
      const usage = readObjectRecord(raw.message?.usage);
      if (!usage) {
        continue;
      }
      inputTokens += Number(usage.input_tokens ?? 0);
      outputTokens += Number(usage.output_tokens ?? 0);
      cacheReadTokens += Number(usage.cache_read_input_tokens ?? 0);
      cacheCreationTokens += Number(usage.cache_creation_input_tokens ?? 0);
    }
    const displayInput = inputTokens + cacheReadTokens;
    const used = inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens;
    const tokenUsage = used > 0 ? {
      used,
      inputTokens: displayInput,
      outputTokens,
      breakdown: { input: displayInput, output: outputTokens },
    } : undefined;

    let total = 0;
    for (const msg of normalized) {
      if (msg.kind !== 'tool_result') {
        total += 1;
      }
    }
    const normalizedOffset = Math.max(0, offset);
    const normalizedLimit = limit === null ? null : Math.max(0, limit);
    const { page, hasMore } = sliceTailPage(normalized, normalizedLimit, normalizedOffset);

    return {
      messages: page,
      total,
      hasMore,
      offset: normalizedOffset,
      limit: normalizedLimit,
      tokenUsage,
    };
  }
}
