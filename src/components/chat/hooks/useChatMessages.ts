/**
 * Message normalization utilities.
 * Converts NormalizedMessage[] from the session store into ChatMessage[] for the UI.
 */

import type { NormalizedMessage } from '../../../stores/useSessionStore';
import type { ChatMessage, SubagentChildTool } from '../types/types';
import { decodeHtmlEntities, unescapeWithMathProtection, formatUsageLimitText } from '../utils/chatFormatting';

/**
 * Convert NormalizedMessage[] from the session store into ChatMessage[]
 * that the existing UI components expect.
 *
 * Internal/system content (e.g. <system-reminder>, <command-name>) is already
 * filtered server-side by the Claude adapter (server/providers/utils.js).
 */
export function normalizedToChatMessages(messages: NormalizedMessage[]): ChatMessage[] {
  const converted: ChatMessage[] = [];

  // First pass: collect tool results for attachment
  const toolResultMap = new Map<string, NormalizedMessage>();
  for (const msg of messages) {
    if (msg.kind === 'tool_result' && msg.toolId) {
      toolResultMap.set(msg.toolId, msg);
    }
  }

  for (const msg of messages) {
    switch (msg.kind) {
      case 'text': {
        const content = msg.content || '';
        if (!content.trim()) continue;

        if (msg.role === 'user') {
          // Parse task notifications
          const taskNotifRegex = /<task-notification>\s*<task-id>[^<]*<\/task-id>\s*<output-file>[^<]*<\/output-file>\s*<status>([^<]*)<\/status>\s*<summary>([^<]*)<\/summary>\s*<\/task-notification>/g;
          const taskNotifMatch = taskNotifRegex.exec(content);
          if (taskNotifMatch) {
            converted.push({
              type: 'assistant',
              content: taskNotifMatch[2]?.trim() || 'Background task finished',
              timestamp: msg.timestamp,
              isTaskNotification: true,
              taskStatus: taskNotifMatch[1]?.trim() || 'completed',
            });
          } else {
            converted.push({
              type: 'user',
              content: unescapeWithMathProtection(decodeHtmlEntities(content)),
              timestamp: msg.timestamp,
            });
          }
        } else {
          let text = decodeHtmlEntities(content);
          text = unescapeWithMathProtection(text);
          text = formatUsageLimitText(text);
          converted.push({
            type: 'assistant',
            content: text,
            timestamp: msg.timestamp,
          });
        }
        break;
      }

      case 'tool_use': {
        const tr = msg.toolResult || (msg.toolId ? toolResultMap.get(msg.toolId) : null);
        const isSubagentContainer = msg.toolName === 'Task';

        // Build child tools from subagentTools
        const childTools: SubagentChildTool[] = [];
        if (isSubagentContainer && msg.subagentTools && Array.isArray(msg.subagentTools)) {
          for (const tool of msg.subagentTools as any[]) {
            childTools.push({
              toolId: tool.toolId,
              toolName: tool.toolName,
              toolInput: tool.toolInput,
              toolResult: tool.toolResult || null,
              timestamp: new Date(tool.timestamp || Date.now()),
            });
          }
        }

        const toolResult = tr
          ? {
              content: typeof tr.content === 'string' ? tr.content : JSON.stringify(tr.content),
              isError: Boolean(tr.isError),
              toolUseResult: (tr as any).toolUseResult,
            }
          : null;

        converted.push({
          type: 'assistant',
          content: '',
          timestamp: msg.timestamp,
          isToolUse: true,
          toolName: msg.toolName,
          toolInput: typeof msg.toolInput === 'string' ? msg.toolInput : JSON.stringify(msg.toolInput ?? '', null, 2),
          toolId: msg.toolId,
          toolResult,
          isSubagentContainer,
          subagentState: isSubagentContainer
            ? {
                childTools,
                currentToolIndex: childTools.length > 0 ? childTools.length - 1 : -1,
                isComplete: Boolean(toolResult),
              }
            : undefined,
        });
        break;
      }

      case 'thinking':
        if (msg.content?.trim()) {
          converted.push({
            type: 'assistant',
            content: unescapeWithMathProtection(msg.content),
            timestamp: msg.timestamp,
            isThinking: true,
          });
        }
        break;

      case 'error':
        converted.push({
          type: 'error',
          content: msg.content || 'Unknown error',
          timestamp: msg.timestamp,
        });
        break;

      case 'interactive_prompt':
        converted.push({
          type: 'assistant',
          content: msg.content || '',
          timestamp: msg.timestamp,
          isInteractivePrompt: true,
        });
        break;

      case 'task_notification':
        converted.push({
          type: 'assistant',
          content: msg.summary || 'Background task update',
          timestamp: msg.timestamp,
          isTaskNotification: true,
          taskStatus: msg.status || 'completed',
        });
        break;

      case 'stream_delta':
        if (msg.content) {
          converted.push({
            type: 'assistant',
            content: msg.content,
            timestamp: msg.timestamp,
            isStreaming: true,
          });
        }
        break;

      // stream_end, complete, status, permission_*, session_created
      // are control events — not rendered as messages
      case 'stream_end':
      case 'complete':
      case 'status':
      case 'permission_request':
      case 'permission_cancelled':
      case 'session_created':
        // Skip — these are handled by useChatRealtimeHandlers
        break;

      // tool_result is handled via attachment to tool_use above
      case 'tool_result':
        break;

      default:
        break;
    }
  }

  return converted;
}
