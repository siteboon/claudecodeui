import type { ChatMessage } from '../types';
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

const toAbsolutePath = (projectPath: string, filePath?: string) => {
  if (!filePath) {
    return filePath;
  }
  return filePath.startsWith('/') ? filePath : `${projectPath}/${filePath}`;
};

export const calculateDiff = (oldStr: string, newStr: string): DiffLine[] => {
  const oldLines = oldStr.split('\n');
  const newLines = newStr.split('\n');

  const diffLines: DiffLine[] = [];
  let oldIndex = 0;
  let newIndex = 0;

  while (oldIndex < oldLines.length || newIndex < newLines.length) {
    const oldLine = oldLines[oldIndex];
    const newLine = newLines[newIndex];

    if (oldIndex >= oldLines.length) {
      diffLines.push({ type: 'added', content: newLine, lineNum: newIndex + 1 });
      newIndex += 1;
      continue;
    }

    if (newIndex >= newLines.length) {
      diffLines.push({ type: 'removed', content: oldLine, lineNum: oldIndex + 1 });
      oldIndex += 1;
      continue;
    }

    if (oldLine === newLine) {
      oldIndex += 1;
      newIndex += 1;
      continue;
    }

    diffLines.push({ type: 'removed', content: oldLine, lineNum: oldIndex + 1 });
    diffLines.push({ type: 'added', content: newLine, lineNum: newIndex + 1 });
    oldIndex += 1;
    newIndex += 1;
  }

  return diffLines;
};

export const createCachedDiffCalculator = (): DiffCalculator => {
  const cache = new Map<string, DiffLine[]>();

  return (oldStr: string, newStr: string) => {
    const key = `${oldStr.length}-${newStr.length}-${oldStr.slice(0, 50)}`;
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
                toolInput: null,
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
                toolInput: toolInput ? JSON.stringify(toolInput) : null,
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

export const convertSessionMessages = (rawMessages: any[]): ChatMessage[] => {
  const converted: ChatMessage[] = [];
  const toolResults = new Map<
    string,
    { content: unknown; isError: boolean; timestamp: Date; toolUseResult: unknown }
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

      const shouldSkip =
        !content ||
        content.startsWith('<command-name>') ||
        content.startsWith('<command-message>') ||
        content.startsWith('<command-args>') ||
        content.startsWith('<local-command-stdout>') ||
        content.startsWith('<system-reminder>') ||
        content.startsWith('Caveat:') ||
        content.startsWith('This session is being continued from a previous') ||
        content.startsWith('[Request interrupted');

      if (!shouldSkip) {
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
        toolInput: message.toolInput || '',
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
            converted.push({
              type: 'assistant',
              content: '',
              timestamp: message.timestamp || new Date().toISOString(),
              isToolUse: true,
              toolName: part.name,
              toolInput: JSON.stringify(part.input),
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
