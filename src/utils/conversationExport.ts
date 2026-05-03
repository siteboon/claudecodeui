type ExportFormat = 'markdown' | 'json' | 'text';

interface ExportableMessage {
  type?: string;
  content?: string;
  [key: string]: unknown;
}

export function exportConversation(
  messages: ExportableMessage[],
  format: ExportFormat,
  title: string,
): string {
  switch (format) {
    case 'markdown':
      return messages
        .map((m) => `### ${m.type === 'user' ? 'User' : 'Assistant'}\n\n${m.content ?? ''}\n`)
        .join('\n---\n\n');
    case 'json':
      return JSON.stringify(
        { title, exportDate: new Date().toISOString(), messages },
        null,
        2,
      );
    case 'text':
      return messages
        .map((m) => `[${m.type === 'user' ? 'User' : 'Assistant'}]\n${m.content ?? ''}\n`)
        .join('\n\n');
  }
}

export function downloadExport(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const MIME_TYPES: Record<ExportFormat, string> = {
  markdown: 'text/markdown',
  json: 'application/json',
  text: 'text/plain',
};

const EXTENSIONS: Record<ExportFormat, string> = {
  markdown: 'md',
  json: 'json',
  text: 'txt',
};

export function exportAndDownload(
  messages: ExportableMessage[],
  format: ExportFormat,
  title: string,
) {
  const content = exportConversation(messages, format, title);
  const safeTitle = title.replace(/[^a-zA-Z0-9-_ ]/g, '').slice(0, 50) || 'conversation';
  downloadExport(content, `${safeTitle}.${EXTENSIONS[format]}`, MIME_TYPES[format]);
}
