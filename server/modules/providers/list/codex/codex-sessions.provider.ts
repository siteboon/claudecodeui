import fsSync from 'node:fs';
import readline from 'node:readline';

import { sessionsDb } from '@/modules/database/index.js';
import { toImageAttachments } from '@/shared/image-attachments.js';
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

/**
 * Reads the image attachments Codex records on `user_message` events.
 * Turns sent with `local_image` input items land in `local_images` as file
 * paths (verified against real rollout JSONL); the `images` array can carry
 * base64 data URLs, which are passed through as inline `data` attachments so
 * the UI can preview them without a file lookup.
 *
 * Exported for tests.
 */
export function extractCodexUserImages(
  payload: AnyRecord | null | undefined,
): Array<{ path?: string; data?: string }> | undefined {
  if (!payload) {
    return undefined;
  }

  const candidates = [
    ...(Array.isArray(payload.local_images) ? payload.local_images : []),
    ...(Array.isArray(payload.images) ? payload.images : []),
  ];

  const attachments: Array<{ path?: string; data?: string }> = [];
  for (const entry of candidates) {
    if (typeof entry !== 'string' || !entry.trim()) {
      continue;
    }
    if (entry.startsWith('data:')) {
      attachments.push({ data: entry });
    } else {
      attachments.push(...toImageAttachments([entry]));
    }
  }

  return attachments.length > 0 ? attachments : undefined;
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

function extractCodexToolOutput(output: unknown): string {
  if (typeof output === 'string') {
    return output;
  }

  if (!Array.isArray(output)) {
    return output == null ? '' : JSON.stringify(output);
  }

  return output
    .map((item) => {
      const record = readObjectRecord(item);
      return typeof record?.text === 'string' ? record.text : '';
    })
    .filter(Boolean)
    .join('');
}

function readRunningExecOutput(output: string): { cellId: string; content: string } | null {
  const runningCell = /Script running with cell ID\s+(\S+)/i.exec(output);
  if (!runningCell) {
    return null;
  }

  const outputMarker = /\r?\nOutput:\r?\n/i.exec(output);
  return {
    cellId: runningCell[1],
    content: outputMarker ? output.slice((outputMarker.index || 0) + outputMarker[0].length) : '',
  };
}

function decodeJavaScriptStringLiteral(literal: string): string {
  if (literal.startsWith('"')) {
    try {
      return JSON.parse(literal) as string;
    } catch {
      return literal.slice(1, -1);
    }
  }

  return literal
    .slice(1, -1)
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\([\\'`])/g, '$1');
}

function extractNestedCodexCommands(source: string): string[] {
  const commands: string[] = [];
  const commandPattern = /\bcommand\s*:\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)/gs;
  for (const match of source.matchAll(commandPattern)) {
    commands.push(decodeJavaScriptStringLiteral(match[1]));
  }

  if (commands.length === 0) {
    const arrayPattern = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*\[([\s\S]*?)\]\s*;/g;
    const stringPattern = /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)/g;

    for (const arrayMatch of source.matchAll(arrayPattern)) {
      const arrayName = arrayMatch[1];
      if (!new RegExp(`\\b${arrayName}\\.map\\s*\\(`).test(source)) {
        continue;
      }
      for (const stringMatch of arrayMatch[2].matchAll(stringPattern)) {
        commands.push(decodeJavaScriptStringLiteral(stringMatch[1]));
      }
    }
  }

  return commands;
}

/**
 * Newer Codex rollouts persist the orchestration wrapper (`exec`) instead of
 * the nested tool name. Recover the useful UI-level operation so history does
 * not degrade into rows labelled only "exec / Parameters".
 */
function translateCodexExecInput(input: unknown): { toolName: string; toolInput: string } | null {
  const source = typeof input === 'string' ? input : String(input || '');
  if (/\btools\.shell_command\s*\(/.test(source)) {
    const commands = extractNestedCodexCommands(source);
    if (commands.length > 0) {
      return {
        toolName: 'Bash',
        toolInput: JSON.stringify({ command: commands.join('\n') }),
      };
    }
  }

  return null;
}

function humanizeCodexToolName(toolName: string): string {
  return toolName
    .replace(/__/g, ' ')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

type CodexSubagentRecord = {
  toolCallId: string;
  message: AnyRecord;
  agentPath?: string;
  isComplete: boolean;
};

function parseCodexSubagentMessage(payload: AnyRecord): {
  author: string;
  messageType: string;
  result: string;
} | null {
  const text = extractCodexTextContent(payload.content);
  const header = /Message Type:\s*([^\r\n]+)[\s\S]*?Sender:\s*([^\r\n]+)[\s\S]*?Payload:\s*\r?\n([\s\S]*)/i.exec(text);
  const author = readNonEmptyString(payload.author) || header?.[2]?.trim();
  if (!author) {
    return null;
  }

  return {
    author,
    messageType: header?.[1]?.trim().toUpperCase() || 'MESSAGE',
    result: header?.[3]?.trim() || '',
  };
}

const CODEX_COLLABORATION_CONTROL_TOOLS = new Set([
  'followup_task',
  'interrupt_agent',
  'list_agents',
  'send_message',
  'wait_agent',
]);

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

async function getCodexSessionMessages(
  sessionId: string,
  limit: number | null = null,
  offset = 0,
): Promise<CodexHistoryResult> {
  try {
    const sessionFilePath = sessionsDb.getSessionById(sessionId)?.jsonl_path;

    if (!sessionFilePath) {
      console.warn(`Codex session file not found for session ${sessionId}`);
      return { messages: [], total: 0, hasMore: false };
    }

    const messages: AnyRecord[] = [];
    let tokenUsage: AnyRecord | null = null;
    const ignoredToolCallIds = new Set<string>();
    const execToolCallIds = new Set<string>();
    const execCallByCellId = new Map<string, string>();
    const waitCallToExecCall = new Map<string, string>();
    const pendingExecOutput = new Map<string, string>();
    const completedExecCalls = new Set<string>();
    const subagentsByCallId = new Map<string, CodexSubagentRecord>();
    const subagentsByPath = new Map<string, CodexSubagentRecord>();
    const fileStream = fsSync.createReadStream(sessionFilePath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

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

        if (
          entry.type === 'event_msg'
          && entry.payload?.type === 'sub_agent_activity'
          && entry.payload.kind === 'started'
        ) {
          const eventId = readNonEmptyString(entry.payload.event_id);
          const agentPath = readNonEmptyString(entry.payload.agent_path);
          const subagent = eventId ? subagentsByCallId.get(eventId) : undefined;
          if (subagent && agentPath) {
            subagent.agentPath = agentPath;
            subagentsByPath.set(agentPath, subagent);
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
            images: extractCodexUserImages(entry.payload as AnyRecord),
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

        if (entry.type === 'response_item' && entry.payload?.type === 'agent_message') {
          const agentMessage = parseCodexSubagentMessage(entry.payload as AnyRecord);
          if (agentMessage && agentMessage.messageType === 'FINAL_ANSWER' && agentMessage.result) {
            let subagent = subagentsByPath.get(agentMessage.author);
            if (!subagent) {
              const fallbackCallId = entry.payload.id || generateMessageId('codex-subagent');
              const taskName = agentMessage.author.split('/').filter(Boolean).pop() || 'agent';
              const taskMessage: AnyRecord = {
                uuid: fallbackCallId,
                type: 'tool_use',
                timestamp: entry.timestamp,
                toolName: 'Task',
                toolInput: JSON.stringify({
                  subagent_type: 'Codex',
                  description: humanizeCodexToolName(taskName),
                }),
                toolCallId: fallbackCallId,
              };
              messages.push(taskMessage);
              subagent = {
                toolCallId: fallbackCallId,
                message: taskMessage,
                agentPath: agentMessage.author,
                isComplete: false,
              };
              subagentsByCallId.set(fallbackCallId, subagent);
              subagentsByPath.set(agentMessage.author, subagent);
            }

            if (!subagent.isComplete) {
              messages.push({
                type: 'tool_result',
                timestamp: entry.timestamp,
                toolCallId: subagent.toolCallId,
                output: agentMessage.result,
              });
              subagent.isComplete = true;
            }
          }
        }

        if (entry.type === 'response_item' && entry.payload?.type === 'function_call') {
          let toolName = entry.payload.name;
          let toolInput = entry.payload.arguments;

          if (toolName === 'spawn_agent') {
            let taskName = 'agent';
            try {
              const args = JSON.parse(String(entry.payload.arguments || '{}')) as AnyRecord;
              taskName = readNonEmptyString(args.task_name) || taskName;
            } catch {
              // The activity event can still provide the canonical agent path.
            }

            const taskMessage: AnyRecord = {
              uuid: entry.payload.call_id,
              type: 'tool_use',
              timestamp: entry.timestamp,
              toolName: 'Task',
              toolInput: JSON.stringify({
                subagent_type: 'Codex',
                description: humanizeCodexToolName(taskName),
              }),
              toolCallId: entry.payload.call_id,
            };
            messages.push(taskMessage);
            subagentsByCallId.set(entry.payload.call_id, {
              toolCallId: entry.payload.call_id,
              message: taskMessage,
              isComplete: false,
            });
            ignoredToolCallIds.add(entry.payload.call_id);
            continue;
          }

          if (toolName === 'wait') {
            try {
              const args = JSON.parse(String(entry.payload.arguments || '{}')) as AnyRecord;
              const cellId = String(args.cell_id || '');
              const execCallId = execCallByCellId.get(cellId);
              if (execCallId) {
                waitCallToExecCall.set(entry.payload.call_id, execCallId);
              }
            } catch {
              // Suppress the orchestration wait even when its payload is malformed.
            }
            ignoredToolCallIds.add(entry.payload.call_id);
            continue;
          }

          if (CODEX_COLLABORATION_CONTROL_TOOLS.has(toolName)) {
            ignoredToolCallIds.add(entry.payload.call_id);
            continue;
          }

          if (toolName === 'shell_command') {
            toolName = 'Bash';
            try {
              const args = JSON.parse(entry.payload.arguments) as AnyRecord;
              toolInput = JSON.stringify({ command: args.command });
            } catch {
              // Keep original arguments when parsing fails.
            }
          }

          messages.push({
            type: 'tool_use',
            timestamp: entry.timestamp,
            toolName,
            toolInput,
            toolCallId: entry.payload.call_id,
          });
        }

        if (entry.type === 'response_item' && entry.payload?.type === 'function_call_output') {
          const waitExecCallId = waitCallToExecCall.get(entry.payload.call_id);
          if (waitExecCallId) {
            const output = extractCodexToolOutput(entry.payload.output);
            const runningOutput = readRunningExecOutput(output);
            const accumulatedOutput = `${pendingExecOutput.get(waitExecCallId) || ''}${runningOutput?.content ?? output}`;
            pendingExecOutput.set(waitExecCallId, accumulatedOutput);

            if (!runningOutput && !completedExecCalls.has(waitExecCallId)) {
              messages.push({
                type: 'tool_result',
                timestamp: entry.timestamp,
                toolCallId: waitExecCallId,
                output: accumulatedOutput,
              });
              completedExecCalls.add(waitExecCallId);
            }
            continue;
          }

          const subagent = subagentsByCallId.get(entry.payload.call_id);
          if (subagent) {
            const output = extractCodexToolOutput(entry.payload.output);
            try {
              const taskPath = readNonEmptyString((JSON.parse(output) as AnyRecord).task_name);
              if (taskPath) {
                subagent.agentPath = taskPath;
                subagentsByPath.set(taskPath, subagent);
              }
            } catch {
              // The sub_agent_activity event normally supplies the path.
            }
            continue;
          }

          if (ignoredToolCallIds.has(entry.payload.call_id)) {
            continue;
          }

          messages.push({
            type: 'tool_result',
            timestamp: entry.timestamp,
            toolCallId: entry.payload.call_id,
            output: extractCodexToolOutput(entry.payload.output),
          });
        }

        if (entry.type === 'response_item' && entry.payload?.type === 'custom_tool_call') {
          let toolName = entry.payload.name || 'custom_tool';
          const input = entry.payload.input || '';

          if (toolName === 'exec') {
            const translated = translateCodexExecInput(input);
            if (!translated) {
              ignoredToolCallIds.add(entry.payload.call_id);
              continue;
            }
            toolName = translated.toolName;
            messages.push({
              type: 'tool_use',
              timestamp: entry.timestamp,
              toolName,
              toolInput: translated.toolInput,
              toolCallId: entry.payload.call_id,
            });
            execToolCallIds.add(entry.payload.call_id);
            continue;
          }

          if (toolName === 'apply_patch') {
            const fileMatch = String(input).match(/\*\*\* Update File: (.+)/);
            const filePath = fileMatch ? fileMatch[1].trim() : 'unknown';
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
                file_path: filePath,
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
          const output = extractCodexToolOutput(entry.payload.output);
          if (execToolCallIds.has(entry.payload.call_id)) {
            const runningOutput = readRunningExecOutput(output);
            if (runningOutput) {
              execCallByCellId.set(runningOutput.cellId, entry.payload.call_id);
              pendingExecOutput.set(entry.payload.call_id, runningOutput.content);
              continue;
            }
            completedExecCalls.add(entry.payload.call_id);
          }

          messages.push({
            type: 'tool_result',
            timestamp: entry.timestamp,
            toolCallId: entry.payload.call_id,
            output,
          });
        }
      } catch {
        // Skip malformed lines.
      }
    }

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
      const rawImages = Array.isArray(raw.images) && raw.images.length > 0 ? raw.images : undefined;
      if (!content.trim() && !rawImages) {
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
        images: rawImages,
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

    if (raw.message?.role) {
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

    let result: CodexHistoryResult;
    try {
      // Load full history first so `total` reflects frontend-normalized messages,
      // not raw JSONL records.
      result = await getCodexSessionMessages(sessionId, null, 0);
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
