import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

import { sessionsDb } from '@/modules/database/index.js';
import { findCodexSubagentTranscriptFiles, readCodexTranscriptMeta } from '@/modules/providers/list/codex/codex-transcripts.js';
import type { IProviderSessions } from '@/shared/interfaces.js';
import type { AnyRecord, FetchHistoryOptions, FetchHistoryResult, NormalizedMessage } from '@/shared/types.js';
import { createNormalizedMessage, generateMessageId, readObjectRecord, sliceTailPage } from '@/shared/utils.js';

const PROVIDER = 'codex';

type CodexHistoryResult =
  | AnyRecord[]
  | {
      messages?: AnyRecord[];
      total?: number;
      hasMore?: boolean;
      offset?: number;
      limit?: number | null;
      tokenUsage?: unknown;
    };

function isVisibleCodexUserMessage(payload: AnyRecord | null | undefined): boolean {
  if (!payload || payload.type !== 'user_message') {
    return false;
  }

  if (payload.kind && payload.kind !== 'plain') {
    return false;
  }

  return typeof payload.message === 'string' && payload.message.trim().length > 0;
}

function extractCodexTextContent(content: unknown): string {
  if (!Array.isArray(content)) {
    return typeof content === 'string' ? content : '';
  }

  return content
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return '';
      }

      const record = item as AnyRecord;
      if (
        (record.type === 'input_text' || record.type === 'output_text' || record.type === 'text')
        && typeof record.text === 'string'
      ) {
        return record.text;
      }

      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function parseJsonRecord(value: unknown): AnyRecord | null {
  if (typeof value !== 'string') {
    return readObjectRecord(value);
  }

  try {
    return readObjectRecord(JSON.parse(value));
  } catch {
    return null;
  }
}

export function codexFunctionCallToTool(entry: AnyRecord): AnyRecord | null {
  const payload = readObjectRecord(entry.payload);
  if (entry.type !== 'response_item' || payload?.type !== 'function_call') {
    return null;
  }

  const toolCallId = typeof payload.call_id === 'string'
    ? payload.call_id
    : generateMessageId('codex-tool');
  const timestamp = entry.timestamp;

  if (payload.name === 'update_plan') {
    const input = parseJsonRecord(payload.arguments);
    const plan = Array.isArray(input?.plan) ? input.plan : [];

    return {
      type: 'tool_use',
      timestamp,
      toolName: 'TodoList',
      toolInput: {
        items: plan
          .map((item) => readObjectRecord(item))
          .filter((item): item is AnyRecord => item !== null)
          .map((item) => ({
            text: typeof item.step === 'string' ? item.step : '',
            status: typeof item.status === 'string' ? item.status : 'pending',
          }))
          .filter((item) => item.text.trim()),
      },
      toolCallId,
    };
  }

  if (payload.name === 'spawn_agent' && payload.namespace === 'multi_agent_v1') {
    const input = parseJsonRecord(payload.arguments);
    const message = typeof input?.message === 'string' ? input.message : '';

    return {
      type: 'tool_use',
      timestamp,
      toolName: 'Task',
      toolInput: {
        subagent_type: typeof input?.agent_type === 'string' ? input.agent_type : 'default',
        description: message ? message.split('\n')[0] : 'Subagent',
        prompt: message,
      },
      toolCallId,
    };
  }

  let toolName = payload.name;
  let toolInput = payload.arguments;
  if (toolName === 'shell_command') {
    toolName = 'Bash';
    const args = parseJsonRecord(payload.arguments);
    if (typeof args?.command === 'string') {
      toolInput = JSON.stringify({ command: args.command });
    }
  }

  return {
    type: 'tool_use',
    timestamp,
    toolName,
    toolInput,
    toolCallId,
  };
}

async function readCodexSessionFileMessages(filePath: string): Promise<{
  messages: AnyRecord[];
  tokenUsage: AnyRecord | null;
}> {
  const messages: AnyRecord[] = [];
  let tokenUsage: AnyRecord | null = null;
  const fileStream = fsSync.createReadStream(filePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  try {
    for await (const line of rl) {
      if (!line.trim()) {
        continue;
      }

      try {
        const entry = JSON.parse(line) as AnyRecord;

        if (entry.type === 'event_msg' && entry.payload?.type === 'token_count' && entry.payload?.info) {
          const info = entry.payload.info as AnyRecord;
          if (info.total_token_usage) {
            const usage = info.total_token_usage as AnyRecord;
            tokenUsage = {
              used: usage.total_tokens || 0,
              total: info.model_context_window || 200000,
            };
          }
        }

        if (entry.type === 'event_msg' && isVisibleCodexUserMessage(entry.payload as AnyRecord)) {
          messages.push({
            type: 'user',
            timestamp: entry.timestamp,
            message: {
              role: 'user',
              content: entry.payload.message,
            },
          });
        }

        if (
          entry.type === 'response_item' &&
          entry.payload?.type === 'message' &&
          entry.payload.role === 'assistant'
        ) {
          const textContent = extractCodexTextContent(entry.payload.content);
          if (textContent.trim()) {
            messages.push({
              type: 'assistant',
              timestamp: entry.timestamp,
              message: {
                role: 'assistant',
                content: textContent,
              },
            });
          }
        }

        if (entry.type === 'response_item' && entry.payload?.type === 'reasoning') {
          const summaryText = Array.isArray(entry.payload.summary)
            ? entry.payload.summary
                .map((item: AnyRecord) => item?.text)
                .filter(Boolean)
                .join('\n')
            : '';

          if (summaryText.trim()) {
            messages.push({
              type: 'thinking',
              timestamp: entry.timestamp,
              message: {
                role: 'assistant',
                content: summaryText,
              },
            });
          }
        }

        const tool = codexFunctionCallToTool(entry);
        if (tool) {
          messages.push(tool);
        }

        if (entry.type === 'response_item' && entry.payload?.type === 'function_call_output') {
          messages.push({
            type: 'tool_result',
            timestamp: entry.timestamp,
            toolCallId: entry.payload.call_id,
            output: entry.payload.output,
          });
        }

        if (entry.type === 'response_item' && entry.payload?.type === 'custom_tool_call') {
          const toolName = entry.payload.name || 'custom_tool';
          const input = entry.payload.input || '';

          if (toolName === 'apply_patch') {
            const fileMatch = String(input).match(/\*\*\* Update File: (.+)/);
            const filePathMatch = fileMatch ? fileMatch[1].trim() : 'unknown';
            const lines = String(input).split('\n');
            const oldLines: string[] = [];
            const newLines: string[] = [];

            for (const lineContent of lines) {
              if (lineContent.startsWith('-') && !lineContent.startsWith('---')) {
                oldLines.push(lineContent.slice(1));
              } else if (lineContent.startsWith('+') && !lineContent.startsWith('+++')) {
                newLines.push(lineContent.slice(1));
              }
            }

            messages.push({
              type: 'tool_use',
              timestamp: entry.timestamp,
              toolName: 'Edit',
              toolInput: JSON.stringify({
                file_path: filePathMatch,
                old_string: oldLines.join('\n'),
                new_string: newLines.join('\n'),
              }),
              toolCallId: entry.payload.call_id,
            });
          } else {
            messages.push({
              type: 'tool_use',
              timestamp: entry.timestamp,
              toolName,
              toolInput: input,
              toolCallId: entry.payload.call_id,
            });
          }
        }

        if (entry.type === 'response_item' && entry.payload?.type === 'custom_tool_call_output') {
          messages.push({
            type: 'tool_result',
            timestamp: entry.timestamp,
            toolCallId: entry.payload.call_id,
            output: entry.payload.output || '',
          });
        }
      } catch {
        // Skip malformed lines.
      }
    }
  } finally {
    rl.close();
    fileStream.destroy();
  }

  return { messages, tokenUsage };
}

async function attachCodexSubagentTools(
  messages: AnyRecord[],
  parentSessionId: string,
  sessionFilePath: string,
): Promise<void> {
  if (!sessionFilePath) {
    return;
  }

  const rootDir = path.join(os.homedir(), '.codex', 'sessions');
  // ponytail: O(n) transcript scan; replace with an index if large Codex histories make parent loading slow.
  const childFiles = await findCodexSubagentTranscriptFiles(parentSessionId, rootDir);
  if (childFiles.length === 0) {
    return;
  }

  const spawnByToolCallId = new Map<string, AnyRecord>();
  for (const message of messages) {
    if (message.type === 'tool_use' && message.toolName === 'Task' && typeof message.toolCallId === 'string') {
      spawnByToolCallId.set(message.toolCallId, message);
    }
  }

  const spawnByAgentId = new Map<string, AnyRecord>();
  for (const message of messages) {
    if (message.type !== 'tool_result' || typeof message.toolCallId !== 'string') {
      continue;
    }

    const result = parseJsonRecord(message.output);
    const agentId = typeof result?.agent_id === 'string' ? result.agent_id : undefined;
    if (!agentId) {
      continue;
    }

    const spawn = spawnByToolCallId.get(message.toolCallId);
    if (spawn) {
      spawnByAgentId.set(agentId, spawn);
    }
  }

  for (const childFile of childFiles) {
    const meta = await readCodexTranscriptMeta(childFile);
    if (!meta) {
      continue;
    }

    const spawn = spawnByAgentId.get(meta.sessionId);
    if (!spawn) {
      continue;
    }

    const child = await readCodexSessionFileMessages(childFile);
    const childToolResults = new Map<string, AnyRecord>();
    for (const message of child.messages) {
      if (message.type === 'tool_result' && typeof message.toolCallId === 'string') {
        childToolResults.set(message.toolCallId, {
          content: message.output || '',
          isError: Boolean(message.isError),
        });
      }
    }

    spawn.subagentTools = child.messages
      .filter((message) => message.type === 'tool_use')
      .map((message) => ({
        toolId: message.toolCallId || generateMessageId('codex-subagent-tool'),
        toolName: message.toolName || 'Unknown',
        toolInput: message.toolInput,
        timestamp: message.timestamp || new Date().toISOString(),
        toolResult: typeof message.toolCallId === 'string'
          ? (childToolResults.get(message.toolCallId) || null)
          : null,
      }));
  }
}

async function getCodexSessionMessages(
  sessionId: string,
  providerSessionId: string,
  limit: number | null = null,
  offset = 0,
): Promise<CodexHistoryResult> {
  try {
    const sessionFilePath = sessionsDb.getSessionById(sessionId)?.jsonl_path;

    if (!sessionFilePath) {
      console.warn(`Codex session file not found for session ${sessionId}`);
      return { messages: [], total: 0, hasMore: false };
    }

    const { messages, tokenUsage } = await readCodexSessionFileMessages(sessionFilePath);
    await attachCodexSubagentTools(messages, providerSessionId, sessionFilePath);

    messages.sort(
      (a, b) => new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime(),
    );
    const total = messages.length;

    if (limit !== null) {
      const startIndex = Math.max(0, total - offset - limit);
      const endIndex = total - offset;
      const paginatedMessages = messages.slice(startIndex, endIndex);
      const hasMore = startIndex > 0;

      return {
        messages: paginatedMessages,
        total,
        hasMore,
        offset,
        limit,
        tokenUsage,
      };
    }

    return { messages, tokenUsage };
  } catch (error) {
    console.error(`Error reading Codex session messages for ${sessionId}:`, error);
    return { messages: [], total: 0, hasMore: false };
  }
}

export class CodexSessionsProvider implements IProviderSessions {
  /**
   * Normalizes a persisted Codex JSONL entry.
   *
   * Live Codex SDK events are transformed before they reach normalizeMessage(),
   * while history entries already use a compact message/tool shape from projects.js.
   */
  private normalizeHistoryEntry(raw: AnyRecord, sessionId: string | null): NormalizedMessage[] {
    const ts = raw.timestamp || new Date().toISOString();
    const baseId = raw.uuid || generateMessageId('codex');

    if (raw.type === 'thinking' || raw.isReasoning) {
      const thinkingContent = typeof raw.message?.content === 'string'
        ? raw.message.content
        : '';
      if (!thinkingContent.trim()) {
        return [];
      }
      return [createNormalizedMessage({
        id: baseId,
        sessionId,
        timestamp: ts,
        provider: PROVIDER,
        kind: 'thinking',
        content: thinkingContent,
      })];
    }

    if (raw.message?.role === 'user') {
      const content = typeof raw.message.content === 'string'
        ? raw.message.content
        : Array.isArray(raw.message.content)
          ? raw.message.content
              .map((part: string | AnyRecord) => typeof part === 'string' ? part : part?.text || '')
              .filter(Boolean)
              .join('\n')
          : String(raw.message.content || '');
      if (!content.trim()) {
        return [];
      }
      return [createNormalizedMessage({
        id: baseId,
        sessionId,
        timestamp: ts,
        provider: PROVIDER,
        kind: 'text',
        role: 'user',
        content,
      })];
    }

    if (raw.message?.role === 'assistant') {
      const content = typeof raw.message.content === 'string'
        ? raw.message.content
        : Array.isArray(raw.message.content)
          ? raw.message.content
              .map((part: string | AnyRecord) => typeof part === 'string' ? part : part?.text || '')
              .filter(Boolean)
              .join('\n')
          : '';
      if (!content.trim()) {
        return [];
      }
      return [createNormalizedMessage({
        id: baseId,
        sessionId,
        timestamp: ts,
        provider: PROVIDER,
        kind: 'text',
        role: 'assistant',
        content,
      })];
    }

    if (raw.type === 'tool_use' || raw.toolName) {
      return [createNormalizedMessage({
        id: baseId,
        sessionId,
        timestamp: ts,
        provider: PROVIDER,
        kind: 'tool_use',
        toolName: raw.toolName || 'Unknown',
        toolInput: raw.toolInput,
        toolId: raw.toolCallId || baseId,
        subagentTools: raw.subagentTools,
      })];
    }

    if (raw.type === 'tool_result') {
      return [createNormalizedMessage({
        id: baseId,
        sessionId,
        timestamp: ts,
        provider: PROVIDER,
        kind: 'tool_result',
        toolId: raw.toolCallId || '',
        content: raw.output || '',
        isError: Boolean(raw.isError),
      })];
    }

    return [];
  }

  /**
   * Normalizes either a Codex history entry or a transformed live SDK event.
   */
  normalizeMessage(rawMessage: unknown, sessionId: string | null): NormalizedMessage[] {
    const raw = readObjectRecord(rawMessage);
    if (!raw) {
      return [];
    }

    if (
      raw.message?.role
      || raw.type === 'thinking'
      || raw.isReasoning
      || raw.type === 'tool_use'
      || raw.toolName
      || raw.type === 'tool_result'
    ) {
      return this.normalizeHistoryEntry(raw, sessionId);
    }

    const ts = raw.timestamp || new Date().toISOString();
    const baseId = raw.uuid || generateMessageId('codex');

    if (raw.type === 'item') {
      switch (raw.itemType) {
        case 'agent_message':
          return [createNormalizedMessage({
            id: baseId,
            sessionId,
            timestamp: ts,
            provider: PROVIDER,
            kind: 'text',
            role: 'assistant',
            content: raw.message?.content || '',
          })];
        case 'reasoning':
          return [createNormalizedMessage({
            id: baseId,
            sessionId,
            timestamp: ts,
            provider: PROVIDER,
            kind: 'thinking',
            content: raw.message?.content || '',
          })];
        case 'command_execution':
          return [createNormalizedMessage({
            id: baseId,
            sessionId,
            timestamp: ts,
            provider: PROVIDER,
            kind: 'tool_use',
            toolName: 'Bash',
            toolInput: { command: raw.command },
            toolId: baseId,
            output: raw.output,
            exitCode: raw.exitCode,
            status: raw.status,
          })];
        case 'file_change':
          return [createNormalizedMessage({
            id: baseId,
            sessionId,
            timestamp: ts,
            provider: PROVIDER,
            kind: 'tool_use',
            toolName: 'FileChanges',
            toolInput: raw.changes,
            toolId: baseId,
            status: raw.status,
          })];
        case 'mcp_tool_call':
          return [createNormalizedMessage({
            id: baseId,
            sessionId,
            timestamp: ts,
            provider: PROVIDER,
            kind: 'tool_use',
            toolName: raw.tool || 'MCP',
            toolInput: raw.arguments,
            toolId: baseId,
            server: raw.server,
            result: raw.result,
            error: raw.error,
            status: raw.status,
          })];
        case 'web_search':
          return [createNormalizedMessage({
            id: baseId,
            sessionId,
            timestamp: ts,
            provider: PROVIDER,
            kind: 'tool_use',
            toolName: 'WebSearch',
            toolInput: { query: raw.query },
            toolId: baseId,
          })];
        case 'todo_list':
          return [createNormalizedMessage({
            id: baseId,
            sessionId,
            timestamp: ts,
            provider: PROVIDER,
            kind: 'tool_use',
            toolName: 'TodoList',
            toolInput: { items: raw.items },
            toolId: baseId,
          })];
        case 'error':
          return [createNormalizedMessage({
            id: baseId,
            sessionId,
            timestamp: ts,
            provider: PROVIDER,
            kind: 'error',
            content: raw.message?.content || 'Unknown error',
          })];
        default:
          return [createNormalizedMessage({
            id: baseId,
            sessionId,
            timestamp: ts,
            provider: PROVIDER,
            kind: 'tool_use',
            toolName: raw.itemType || 'Unknown',
            toolInput: raw.item || raw,
            toolId: baseId,
          })];
      }
    }

    if (raw.type === 'turn_complete') {
      return [createNormalizedMessage({
        id: baseId,
        sessionId,
        timestamp: ts,
        provider: PROVIDER,
        kind: 'complete',
        exitCode: 0,
        success: true,
        aborted: false,
      })];
    }
    if (raw.type === 'turn_failed') {
      return [createNormalizedMessage({
        id: baseId,
        sessionId,
        timestamp: ts,
        provider: PROVIDER,
        kind: 'error',
        content: raw.error?.message || 'Turn failed',
      })];
    }

    return [];
  }

  /**
   * Loads Codex JSONL history and keeps token usage metadata when projects.js
   * provides it.
   */
  async fetchHistory(
    sessionId: string,
    options: FetchHistoryOptions = {},
  ): Promise<FetchHistoryResult> {
    const { limit = null, offset = 0 } = options;
    const providerSessionId = options.providerSessionId ?? sessionId;

    let result: CodexHistoryResult;
    try {
      // Load full history first so `total` reflects frontend-normalized messages,
      // not raw JSONL records.
      result = await getCodexSessionMessages(sessionId, providerSessionId, null, 0);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[CodexProvider] Failed to load session ${sessionId}:`, message);
      return { messages: [], total: 0, hasMore: false, offset: 0, limit: null };
    }

    const rawMessages = Array.isArray(result) ? result : (result.messages || []);
    const tokenUsage = Array.isArray(result) ? undefined : result.tokenUsage;

    const normalized: NormalizedMessage[] = [];
    for (const raw of rawMessages) {
      normalized.push(...this.normalizeHistoryEntry(raw, sessionId));
    }

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
