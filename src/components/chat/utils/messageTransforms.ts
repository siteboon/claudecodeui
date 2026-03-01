import type { ChatMessage } from '../types/types';
import { decodeHtmlEntities, unescapeWithMathProtection } from './chatFormatting';

export interface DiffLine {
  type: 'added' | 'removed';
  content: string;
  lineNum: number;
}

export type DiffCalculator = (oldStr: string, newStr: string) => DiffLine[];

type CursorBlob = {
  id?: string;
  sequence?: number;
  rowid?: number;
  content?: any;
};

const asArray = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

const normalizeToolInput = (value: unknown): string => {
  if (value === null || value === undefined || value === '') {
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

const toAbsolutePath = (projectPath: string, filePath?: string) => {
  if (!filePath) {
    return filePath;
  }
  return filePath.startsWith('/') ? filePath : `${projectPath}/${filePath}`;
};

export const calculateDiff = (oldStr: string, newStr: string): DiffLine[] => {
  const oldLines = (oldStr ?? '').split('\n');
  const newLines = (newStr ?? '').split('\n');

  // Use LCS alignment so insertions/deletions don't cascade into a full-file "changed" diff.
  const lcsTable: number[][] = Array.from({ length: oldLines.length + 1 }, () =>
    new Array<number>(newLines.length + 1).fill(0),
  );
  for (let oldIndex = oldLines.length - 1; oldIndex >= 0; oldIndex -= 1) {
    for (let newIndex = newLines.length - 1; newIndex >= 0; newIndex -= 1) {
      if (oldLines[oldIndex] === newLines[newIndex]) {
        lcsTable[oldIndex][newIndex] = lcsTable[oldIndex + 1][newIndex + 1] + 1;
      } else {
        lcsTable[oldIndex][newIndex] = Math.max(
          lcsTable[oldIndex + 1][newIndex],
          lcsTable[oldIndex][newIndex + 1],
        );
      }
    }
  }

  const diffLines: DiffLine[] = [];
  let oldIndex = 0;
  let newIndex = 0;

  while (oldIndex < oldLines.length && newIndex < newLines.length) {
    const oldLine = oldLines[oldIndex];
    const newLine = newLines[newIndex];

    if (oldLine === newLine) {
      oldIndex += 1;
      newIndex += 1;
      continue;
    }

    if (lcsTable[oldIndex + 1][newIndex] >= lcsTable[oldIndex][newIndex + 1]) {
      diffLines.push({ type: 'removed', content: oldLine, lineNum: oldIndex + 1 });
      oldIndex += 1;
      continue;
    }

    diffLines.push({ type: 'added', content: newLine, lineNum: newIndex + 1 });
    newIndex += 1;
  }

  while (oldIndex < oldLines.length) {
    diffLines.push({ type: 'removed', content: oldLines[oldIndex], lineNum: oldIndex + 1 });
    oldIndex += 1;
  }

  while (newIndex < newLines.length) {
    diffLines.push({ type: 'added', content: newLines[newIndex], lineNum: newIndex + 1 });
    newIndex += 1;
  }

  return diffLines;
};

export const createCachedDiffCalculator = (): DiffCalculator => {
  const cache = new Map<string, DiffLine[]>();

  return (oldStr: string, newStr: string) => {
    const key = JSON.stringify([oldStr, newStr]);
    const cached = cache.get(key);
    if (cached) {
      return cached;
    }

    const calculated = calculateDiff(oldStr, newStr);
    cache.set(key, calculated);
    if (cache.size > 100) {
      const firstKey = cache.keys().next().value;
      if (firstKey) {
        cache.delete(firstKey);
      }
    }
    return calculated;
  };
};

export const convertCursorSessionMessages = (blobs: CursorBlob[], projectPath: string): ChatMessage[] => {
  const converted: ChatMessage[] = [];
  const toolUseMap: Record<string, ChatMessage> = {};

  for (let blobIdx = 0; blobIdx < blobs.length; blobIdx += 1) {
    const blob = blobs[blobIdx];
    const content = blob.content;
    let text = '';
    let role: ChatMessage['type'] = 'assistant';
    let reasoningText: string | null = null;

    try {
      if (content?.role && content?.content) {
        if (content.role === 'system') {
          continue;
        }

        if (content.role === 'tool') {
          const toolItems = asArray<any>(content.content);
          for (const item of toolItems) {
            if (item?.type !== 'tool-result') {
              continue;
            }

            const toolName = item.toolName === 'ApplyPatch' ? 'Edit' : item.toolName || 'Unknown Tool';
            const toolCallId = item.toolCallId || content.id;
            const result = item.result || '';

            if (toolCallId && toolUseMap[toolCallId]) {
              toolUseMap[toolCallId].toolResult = {
                content: result,
                isError: false,
              };
            } else {
              converted.push({
                type: 'assistant',
                content: '',
                timestamp: new Date(Date.now() + blobIdx * 1000),
                blobId: blob.id,
                sequence: blob.sequence,
                rowid: blob.rowid,
                isToolUse: true,
                toolName,
                toolId: toolCallId,
                toolInput: normalizeToolInput(null),
                toolResult: {
                  content: result,
                  isError: false,
                },
              });
            }
          }
          continue;
        }

        role = content.role === 'user' ? 'user' : 'assistant';

        if (Array.isArray(content.content)) {
          const textParts: string[] = [];

          for (const part of content.content) {
            if (part?.type === 'text' && part?.text) {
              textParts.push(decodeHtmlEntities(part.text));
              continue;
            }

            if (part?.type === 'reasoning' && part?.text) {
              reasoningText = decodeHtmlEntities(part.text);
              continue;
            }

            if (part?.type === 'tool-call' || part?.type === 'tool_use') {
              if (textParts.length > 0 || reasoningText) {
                converted.push({
                  type: role,
                  content: textParts.join('\n'),
                  reasoning: reasoningText ?? undefined,
                  timestamp: new Date(Date.now() + blobIdx * 1000),
                  blobId: blob.id,
                  sequence: blob.sequence,
                  rowid: blob.rowid,
                });
                textParts.length = 0;
                reasoningText = null;
              }

              const toolNameRaw = part.toolName || part.name || 'Unknown Tool';
              const toolName = toolNameRaw === 'ApplyPatch' ? 'Edit' : toolNameRaw;
              const toolId = part.toolCallId || part.id || `tool_${blobIdx}`;
              let toolInput = part.args || part.input;

              if (toolName === 'Edit' && part.args) {
                if (part.args.patch) {
                  const patchLines = String(part.args.patch).split('\n');
                  const oldLines: string[] = [];
                  const newLines: string[] = [];
                  let inPatch = false;

                  patchLines.forEach((line) => {
                    if (line.startsWith('@@')) {
                      inPatch = true;
                      return;
                    }
                    if (!inPatch) {
                      return;
                    }

                    if (line.startsWith('-')) {
                      oldLines.push(line.slice(1));
                    } else if (line.startsWith('+')) {
                      newLines.push(line.slice(1));
                    } else if (line.startsWith(' ')) {
                      oldLines.push(line.slice(1));
                      newLines.push(line.slice(1));
                    }
                  });

                  toolInput = {
                    file_path: toAbsolutePath(projectPath, part.args.file_path),
                    old_string: oldLines.join('\n') || part.args.patch,
                    new_string: newLines.join('\n') || part.args.patch,
                  };
                } else {
                  toolInput = part.args;
                }
              } else if (toolName === 'Read' && part.args) {
                const filePath = part.args.path || part.args.file_path;
                toolInput = {
                  file_path: toAbsolutePath(projectPath, filePath),
                };
              } else if (toolName === 'Write' && part.args) {
                const filePath = part.args.path || part.args.file_path;
                toolInput = {
                  file_path: toAbsolutePath(projectPath, filePath),
                  content: part.args.contents || part.args.content,
                };
              }

              const toolMessage: ChatMessage = {
                type: 'assistant',
                content: '',
                timestamp: new Date(Date.now() + blobIdx * 1000),
                blobId: blob.id,
                sequence: blob.sequence,
                rowid: blob.rowid,
                isToolUse: true,
                toolName,
                toolId,
                toolInput: normalizeToolInput(toolInput),
                toolResult: null,
              };
              converted.push(toolMessage);
              toolUseMap[toolId] = toolMessage;
              continue;
            }

            if (typeof part === 'string') {
              textParts.push(part);
            }
          }

          if (textParts.length > 0) {
            text = textParts.join('\n');
            if (reasoningText && !text) {
              converted.push({
                type: role,
                content: '',
                reasoning: reasoningText,
                timestamp: new Date(Date.now() + blobIdx * 1000),
                blobId: blob.id,
                sequence: blob.sequence,
                rowid: blob.rowid,
              });
              text = '';
            }
          } else {
            text = '';
          }
        } else if (typeof content.content === 'string') {
          text = content.content;
        }
      } else if (content?.message?.role && content?.message?.content) {
        if (content.message.role === 'system') {
          continue;
        }

        role = content.message.role === 'user' ? 'user' : 'assistant';
        if (Array.isArray(content.message.content)) {
          text = content.message.content
            .map((part: any) => (typeof part === 'string' ? part : part?.text || ''))
            .filter(Boolean)
            .join('\n');
        } else if (typeof content.message.content === 'string') {
          text = content.message.content;
        }
      }
    } catch (error) {
      console.log('Error parsing blob content:', error);
    }

    if (text && text.trim()) {
      const message: ChatMessage = {
        type: role,
        content: text,
        timestamp: new Date(Date.now() + blobIdx * 1000),
        blobId: blob.id,
        sequence: blob.sequence,
        rowid: blob.rowid,
      };
      if (reasoningText) {
        message.reasoning = reasoningText;
      }
      converted.push(message);
    }
  }

  converted.sort((messageA, messageB) => {
    if (messageA.sequence !== undefined && messageB.sequence !== undefined) {
      return Number(messageA.sequence) - Number(messageB.sequence);
    }
    if (messageA.rowid !== undefined && messageB.rowid !== undefined) {
      return Number(messageA.rowid) - Number(messageB.rowid);
    }
    return new Date(messageA.timestamp).getTime() - new Date(messageB.timestamp).getTime();
  });

  return converted;
};

interface ClassifiedMessage {
  injectedType: ChatMessage['injectedType'];
  injectedSummary: string;
  taskStatus?: string;
}

const classifyUserMessage = (content: string): ClassifiedMessage | null => {
  // 1. <task-notification> — parse status/summary
  const taskNotifRegex = /<task-notification>\s*<task-id>[^<]*<\/task-id>\s*(?:<tool-use-id>[^<]*<\/tool-use-id>\s*)?<output-file>[^<]*<\/output-file>\s*<status>([^<]*)<\/status>\s*<summary>([^<]*)<\/summary>\s*<\/task-notification>/;
  const taskMatch = taskNotifRegex.exec(content);
  if (taskMatch) {
    return {
      injectedType: 'task-notification',
      injectedSummary: taskMatch[2]?.trim() || 'Background task finished',
      taskStatus: taskMatch[1]?.trim() || 'completed',
    };
  }

  // 2. <system-reminder> — extract first meaningful line as summary
  if (content.startsWith('<system-reminder>')) {
    const innerMatch = content.match(/<system-reminder>\s*\n?(.*)/s);
    const firstLine = innerMatch?.[1]?.split('\n').find(l => l.trim())?.trim() || 'System reminder';
    return {
      injectedType: 'system-reminder',
      injectedSummary: firstLine.length > 80 ? firstLine.slice(0, 77) + '...' : firstLine,
    };
  }

  // 3. Command-related tags
  if (content.startsWith('<command-name>')) {
    const nameMatch = content.match(/<command-name>([^<]*)<\/command-name>/);
    return {
      injectedType: 'command',
      injectedSummary: nameMatch?.[1]?.trim() || 'Command',
    };
  }
  if (content.startsWith('<command-message>') || content.startsWith('<command-args>')) {
    return {
      injectedType: 'command',
      injectedSummary: 'Command arguments',
    };
  }
  if (content.startsWith('<local-command-stdout>') || content.startsWith('<local-command-caveat>')) {
    return {
      injectedType: 'command',
      injectedSummary: 'Command output',
    };
  }

  // 4. Hook output
  if (content.startsWith('<user-prompt-submit-hook>') || content.includes('<user-prompt-submit-hook>')) {
    return {
      injectedType: 'hook',
      injectedSummary: 'Hook output',
    };
  }

  // 5. Background task completion results (injected by server after subagent finishes)
  if (content.startsWith('[Background task completed]')) {
    const agentMatch = content.match(/Agent\s+(\S+)\s+finished/);
    const agentId = agentMatch?.[1] || '';
    const summary = agentId ? `Agent ${agentId} completed` : 'Background task completed';
    return {
      injectedType: 'background-task-result',
      injectedSummary: summary,
    };
  }

  // 6. Session continuation / interruption / errors
  if (content.startsWith('Caveat:')) {
    return {
      injectedType: 'continuation',
      injectedSummary: content.length > 80 ? content.slice(0, 77) + '...' : content,
    };
  }
  if (content.startsWith('This session is being continued from a previous') || content.startsWith('This session is a continuation')) {
    return {
      injectedType: 'continuation',
      injectedSummary: 'Session continuation',
    };
  }
  if (content.startsWith('[Request interrupted')) {
    return {
      injectedType: 'continuation',
      injectedSummary: 'Request interrupted',
    };
  }
  if (content.startsWith('Invalid API key')) {
    return {
      injectedType: 'other',
      injectedSummary: 'Invalid API key',
    };
  }
  if (content === 'Warmup') {
    return {
      injectedType: 'other',
      injectedSummary: 'Warmup',
    };
  }
  // TaskMaster system prompts (should be hidden)
  if (content.includes('{"subtasks":') || content.includes('CRITICAL: You MUST respond with ONLY a JSON')) {
    return {
      injectedType: 'other',
      injectedSummary: 'TaskMaster system prompt',
    };
  }

  return null;
};

export const convertSessionMessages = (rawMessages: any[]): ChatMessage[] => {
  const converted: ChatMessage[] = [];
  const toolResults = new Map<
    string,
    { content: unknown; isError: boolean; timestamp: Date; toolUseResult: unknown; subagentTools?: unknown[] }
  >();

  rawMessages.forEach((message) => {
    if (message.message?.role === 'user' && Array.isArray(message.message?.content)) {
      message.message.content.forEach((part: any) => {
        if (part.type !== 'tool_result') {
          return;
        }
        toolResults.set(part.tool_use_id, {
          content: part.content,
          isError: Boolean(part.is_error),
          timestamp: new Date(message.timestamp || Date.now()),
          toolUseResult: message.toolUseResult || null,
          subagentTools: message.subagentTools,
        });
      });
    }
  });

  rawMessages.forEach((message) => {
    if (message.message?.role === 'user' && message.message?.content) {
      let content = '';
      if (Array.isArray(message.message.content)) {
        const textParts: string[] = [];
        message.message.content.forEach((part: any) => {
          if (part.type === 'text') {
            textParts.push(decodeHtmlEntities(part.text));
          }
        });
        content = textParts.join('\n');
      } else if (typeof message.message.content === 'string') {
        content = decodeHtmlEntities(message.message.content);
      } else {
        content = decodeHtmlEntities(String(message.message.content));
      }

      if (!content) {
        return;
      }

      const classified = classifyUserMessage(content);
      if (classified) {
        // Task notifications keep existing compact pill rendering (backward compat)
        if (classified.injectedType === 'task-notification') {
          converted.push({
            type: 'assistant',
            content: classified.injectedSummary || content,
            timestamp: message.timestamp || new Date().toISOString(),
            isTaskNotification: true,
            taskStatus: classified.taskStatus || 'completed',
            isSystemInjected: true,
            injectedType: 'task-notification',
            injectedSummary: classified.injectedSummary,
          });
        } else if (classified.injectedType === 'background-task-result') {
          // Background task result: collapsible card, collapsed by default
          const resultIdx = content.indexOf('\n\nResult:\n');
          const resultBody = resultIdx >= 0 ? content.slice(resultIdx + '\n\nResult:\n'.length) : content;
          converted.push({
            type: 'assistant',
            content: resultBody,
            timestamp: message.timestamp || new Date().toISOString(),
            isSystemInjected: true,
            injectedType: 'background-task-result',
            injectedSummary: classified.injectedSummary,
          });
        } else {
          // All other system-injected messages: show with muted styling
          converted.push({
            type: 'user',
            content,
            timestamp: message.timestamp || new Date().toISOString(),
            isSystemInjected: true,
            injectedType: classified.injectedType,
            injectedSummary: classified.injectedSummary,
          });
        }
      } else {
        converted.push({
          type: 'user',
          content: unescapeWithMathProtection(content),
          timestamp: message.timestamp || new Date().toISOString(),
        });
      }
      return;
    }

    if (message.type === 'thinking' && message.message?.content) {
      converted.push({
        type: 'assistant',
        content: unescapeWithMathProtection(message.message.content),
        timestamp: message.timestamp || new Date().toISOString(),
        isThinking: true,
      });
      return;
    }

    if (message.type === 'tool_use' && message.toolName) {
      converted.push({
        type: 'assistant',
        content: '',
        timestamp: message.timestamp || new Date().toISOString(),
        isToolUse: true,
        toolName: message.toolName,
        toolInput: normalizeToolInput(message.toolInput),
        toolCallId: message.toolCallId,
      });
      return;
    }

    if (message.type === 'tool_result') {
      for (let index = converted.length - 1; index >= 0; index -= 1) {
        const convertedMessage = converted[index];
        if (!convertedMessage.isToolUse || convertedMessage.toolResult) {
          continue;
        }
        if (!message.toolCallId || convertedMessage.toolCallId === message.toolCallId) {
          convertedMessage.toolResult = {
            content: message.output || '',
            isError: false,
          };
          break;
        }
      }
      return;
    }

    if (message.message?.role === 'assistant' && message.message?.content) {
      if (Array.isArray(message.message.content)) {
        message.message.content.forEach((part: any) => {
          if (part.type === 'text') {
            let text = part.text;
            if (typeof text === 'string') {
              text = unescapeWithMathProtection(text);
            }
            converted.push({
              type: 'assistant',
              content: text,
              timestamp: message.timestamp || new Date().toISOString(),
            });
            return;
          }

          if (part.type === 'tool_use') {
            const toolResult = toolResults.get(part.id);
            const isSubagentContainer = part.name === 'Task';

            // Build child tools from server-provided subagentTools data
            const childTools: import('../types/types').SubagentChildTool[] = [];
            if (isSubagentContainer && toolResult?.subagentTools && Array.isArray(toolResult.subagentTools)) {
              for (const tool of toolResult.subagentTools as any[]) {
                childTools.push({
                  toolId: tool.toolId,
                  toolName: tool.toolName,
                  toolInput: tool.toolInput,
                  toolResult: tool.toolResult || null,
                  timestamp: new Date(tool.timestamp || Date.now()),
                });
              }
            }

            converted.push({
              type: 'assistant',
              content: '',
              timestamp: message.timestamp || new Date().toISOString(),
              isToolUse: true,
              toolName: part.name,
              toolInput: normalizeToolInput(part.input),
              toolId: part.id,
              toolResult: toolResult
                ? {
                    content:
                      typeof toolResult.content === 'string'
                        ? toolResult.content
                        : JSON.stringify(toolResult.content),
                    isError: toolResult.isError,
                    toolUseResult: toolResult.toolUseResult,
                  }
                : null,
              toolError: toolResult?.isError || false,
              toolResultTimestamp: toolResult?.timestamp || new Date(),
              isSubagentContainer,
              subagentState: isSubagentContainer
                ? {
                    childTools,
                    currentToolIndex: childTools.length > 0 ? childTools.length - 1 : -1,
                    isComplete: Boolean(toolResult),
                  }
                : undefined,
            });
          }
        });
        return;
      }

      if (typeof message.message.content === 'string') {
        converted.push({
          type: 'assistant',
          content: unescapeWithMathProtection(message.message.content),
          timestamp: message.timestamp || new Date().toISOString(),
        });
      }
    }
  });

  return converted;
};
