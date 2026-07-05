import type { ChatMessage } from '../types/types';

function stringifyContent(value: unknown): string {
  if (typeof value === 'string') {
    return value.trim();
  }
  if (value === null || value === undefined) {
    return '';
  }
  return JSON.stringify(value, null, 2);
}

function messageHeading(message: ChatMessage): string {
  if (message.type === 'user') return 'User';
  if (message.type === 'error') return 'Error';
  if (message.isThinking) return 'Thinking';
  if (message.isTaskNotification) return 'Task notification';
  if (message.isToolUse) return `Tool: ${message.toolName || 'UnknownTool'}`;
  return 'Assistant';
}

export function exportSessionAsMarkdown(messages: ChatMessage[], title = 'CloudCLI session'): string {
  const sections = [`# ${title.trim() || 'CloudCLI session'}`];

  for (const message of messages) {
    const content = stringifyContent(message.displayText || message.content || message.toolInput);
    if (!content) {
      continue;
    }

    sections.push(`## ${messageHeading(message)}`);
    sections.push(content);
  }

  return `${sections.join('\n\n')}\n`;
}

export function downloadSessionMarkdown(markdown: string, filename: string): void {
  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
