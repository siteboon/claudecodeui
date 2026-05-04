export interface ExportableMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: string;
}

export type ExportFormat = 'markdown' | 'json' | 'txt';

export function exportConversation(
  messages: ExportableMessage[],
  format: ExportFormat,
  sessionTitle?: string,
): string {
  switch (format) {
    case 'markdown':
      return exportAsMarkdown(messages, sessionTitle);
    case 'json':
      return exportAsJson(messages, sessionTitle);
    case 'txt':
      return exportAsTxt(messages, sessionTitle);
    default:
      return exportAsTxt(messages, sessionTitle);
  }
}

function exportAsMarkdown(messages: ExportableMessage[], title?: string): string {
  const lines: string[] = [];
  if (title) lines.push(`# ${title}`, '');
  for (const msg of messages) {
    const label = msg.role === 'user' ? '**You**' : msg.role === 'assistant' ? '**Assistant**' : '**System**';
    lines.push(`### ${label}`);
    if (msg.timestamp) lines.push(`_${msg.timestamp}_`);
    lines.push('', msg.content, '');
  }
  return lines.join('\n');
}

function exportAsJson(messages: ExportableMessage[], title?: string): string {
  return JSON.stringify({ title: title ?? null, messages }, null, 2);
}

function exportAsTxt(messages: ExportableMessage[], title?: string): string {
  const lines: string[] = [];
  if (title) lines.push(title, '='.repeat(title.length), '');
  for (const msg of messages) {
    const label = msg.role === 'user' ? 'You' : msg.role === 'assistant' ? 'Assistant' : 'System';
    lines.push(`[${label}]`);
    if (msg.timestamp) lines.push(msg.timestamp);
    lines.push(msg.content, '');
  }
  return lines.join('\n');
}

export function downloadConversation(
  messages: ExportableMessage[],
  format: ExportFormat,
  sessionTitle?: string,
): void {
  const content = exportConversation(messages, format, sessionTitle);
  const ext = format === 'markdown' ? 'md' : format;
  const mimeType = format === 'json' ? 'application/json' : 'text/plain';
  const filename = `${(sessionTitle || 'conversation').replace(/[^a-z0-9]/gi, '-').toLowerCase()}.${ext}`;

  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
