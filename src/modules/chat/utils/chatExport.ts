import type { ChatMessage } from '@/shared/types';

export type ExportOptions = {
  includeMeta?: boolean;
  format?: 'markdown' | 'pdf' | 'docx';
  provider?: string;
  assistantName?: string;
}

/**
 * Get display name for the assistant based on provider or custom name.
 */
export function getAssistantDisplayName(provider?: string, customName?: string): string {
  if (customName) return customName;
  if (!provider) return 'Assistant';
  const map: Record<string, string> = {
    antigravity: 'Antigravity',
    claude: 'Claude',
    codex: 'Codex',
    cursor: 'Cursor',
    opencode: 'OpenCode',
    zcode: 'ZCode',
  };
  return map[provider.toLowerCase()] || provider.charAt(0).toUpperCase() + provider.slice(1);
}

/**
 * Format a timestamp for display in exports.
 */
function formatTimestamp(date: Date | string | number): string {
  const d = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date;
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(d);
}

function escapeHTML(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Convert messages to markdown format with proper styling and structure.
 */
export function exportToMarkdown(
  messages: ChatMessage[],
  sessionTitle?: string,
  options: Partial<ExportOptions> = {},
): string {
  const includeMeta = options.includeMeta ?? true;
  const assistantName = getAssistantDisplayName(options.provider, options.assistantName);

  let markdown = '';

  // Header
  if (includeMeta) {
    markdown += `# ${sessionTitle || 'Chat Export'}\n\n`;
    markdown += `**Exported:** ${formatTimestamp(new Date())}\n\n`;
    markdown += `---\n\n`;
  }

  // Messages
  for (const msg of messages) {
    // Skip tool use messages
    if (msg.isToolUse || msg.type === 'tool') {
      continue;
    }

    const content = typeof msg.content === 'string' ? msg.content : String(msg.content ?? '');
    const hasImages = Array.isArray(msg.images) && msg.images.length > 0;
    const hasFiles = Array.isArray(msg.files) && msg.files.length > 0;

    // Skip empty messages
    if (!content.trim() && !hasImages && !hasFiles) {
      continue;
    }

    if (msg.type === 'user') {
      markdown += '## You\n\n';
    } else if (msg.type === 'assistant') {
      markdown += `## ${assistantName}\n\n`;
    } else if (msg.type === 'error') {
      markdown += '## ⚠️ Error\n\n';
    } else {
      continue;
    }

    if (content.trim()) {
      markdown += `${content}\n\n`;
    }

    if (includeMeta && msg.timestamp) {
      markdown += `<small>${formatTimestamp(msg.timestamp)}</small>\n\n`;
    }

    markdown += '---\n\n';
  }

  return markdown;
}

/**
 * Export messages to a downloadable markdown file.
 */
export function downloadMarkdown(
  messages: ChatMessage[],
  filename: string = 'chat-export.md',
  sessionTitle?: string,
  options: Partial<ExportOptions> = {},
): void {
  const content = exportToMarkdown(messages, sessionTitle, options);
  const blob = new Blob([content], { type: 'text/markdown' });
  downloadBlob(blob, filename);
}

/**
 * Export messages to HTML (for PDF conversion or viewing).
 */
export function exportToHTML(
  messages: ChatMessage[],
  sessionTitle?: string,
  options: Partial<ExportOptions> = {},
): string {
  const includeMeta = options.includeMeta ?? true;
  const assistantName = getAssistantDisplayName(options.provider, options.assistantName);

  const filteredMessages = messages.filter((msg) => {
    if (msg.isToolUse || msg.type === 'tool') return false;
    const content = typeof msg.content === 'string' ? msg.content : String(msg.content ?? '');
    const hasImages = Array.isArray(msg.images) && msg.images.length > 0;
    const hasFiles = Array.isArray(msg.files) && msg.files.length > 0;
    return content.trim().length > 0 || hasImages || hasFiles;
  });

  const htmlContent = filteredMessages
    .map((msg) => {
      const type = msg.type === 'user' ? '👤 You' : msg.type === 'assistant' ? `🤖 ${assistantName}` : `${msg.type}`;
      const time = includeMeta && msg.timestamp ? `<p style="font-size: 12px; color: #999; margin-top: 8px;">${formatTimestamp(msg.timestamp)}</p>` : '';

      const contentStr = typeof msg.content === 'string' ? msg.content : String(msg.content ?? '');
      const contentHTML = escapeHTML(contentStr);

      return `
        <div style="margin-bottom: 24px; padding: 16px; border-radius: 8px; background-color: ${msg.type === 'user' ? '#e3f2fd' : '#f5f5f5'};">
          <h3 style="margin: 0 0 12px 0; font-size: 14px; font-weight: 600; color: #333;">${type}</h3>
          <p style="margin: 0; white-space: pre-wrap; word-wrap: break-word; color: #555; font-size: 14px; line-height: 1.6;">${contentHTML}</p>
          ${time}
        </div>
      `;
    })
    .join('');

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${escapeHTML(sessionTitle || 'Chat Export')}</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            max-width: 800px;
            margin: 0 auto;
            padding: 24px;
            background-color: #fafafa;
            color: #333;
          }
          h1 { margin: 0 0 8px 0; }
          .meta { color: #999; font-size: 13px; margin-bottom: 24px; }
          .divider { border-top: 1px solid #ddd; margin: 24px 0; }
        </style>
      </head>
      <body>
        <h1>${escapeHTML(sessionTitle || 'Chat Export')}</h1>
        <div class="meta">Exported on ${formatTimestamp(new Date())}</div>
        <div class="divider"></div>
        ${htmlContent}
      </body>
    </html>
  `;
}

/**
 * Export to PDF by converting HTML via external service (requires html2pdf library or server).
 * For now, we'll generate a downloadable HTML that can be printed to PDF.
 */
export function downloadHTML(
  messages: ChatMessage[],
  filename: string = 'chat-export.html',
  sessionTitle?: string,
  options: Partial<ExportOptions> = {},
): void {
  const content = exportToHTML(messages, sessionTitle, options);
  const blob = new Blob([content], { type: 'text/html;charset=utf-8' });
  downloadBlob(blob, filename);
}

/**
 * Create a DOCX file (simplified; full implementation requires docx library).
 * For now, returns HTML that can be opened in Word.
 */
export function downloadWord(
  messages: ChatMessage[],
  filename: string = 'chat-export.html',
  sessionTitle?: string,
  options: Partial<ExportOptions> = {},
): void {
  // Fallback to HTML export since generating true DOCX requires additional library
  downloadHTML(messages, filename, sessionTitle, options);
}

/**
 * Download PDF using the browser's print dialog.
 */
export function downloadPDF(
  messages: ChatMessage[],
  _filename: string = 'chat-export',
  sessionTitle?: string,
  options: Partial<ExportOptions> = {},
): void {
  const htmlContent = exportToHTML(messages, sessionTitle, options);
  const win = window.open('', '', 'width=800,height=600');
  if (!win) {
    window.alert('PDF export could not start because the browser blocked the popup. Allow popups and try again.');
    return;
  }

  win.document.write(htmlContent);
  win.document.close();
  // Delay print dialog to ensure content is loaded
  setTimeout(() => {
    win.print();
    // Optionally close after printing
    // win.close();
  }, 250);
}

/**
 * Helper to download a blob as a file.
 */
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Get all export formats available.
 */
export const EXPORT_FORMATS = [
  { id: 'markdown', label: 'Markdown (.md)', ext: '.md' },
  { id: 'html', label: 'Web Page (.html)', ext: '.html' },
  { id: 'pdf', label: 'PDF (Print to File)', ext: '.pdf' },
] as const;
