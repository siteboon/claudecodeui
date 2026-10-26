/**
 * Turns a loaded transcript into a downloadable file.
 *
 * The HTML path renders the app's real transcript components, so an exported
 * conversation looks like the one on screen — tool cards, diffs, highlighted
 * code, subagent timelines and all. Markdown and JSON are the plain-text and
 * machine-readable views of the same messages.
 */

import type { ChatMessage, DiffLine, LLMProvider, Project } from '@/shared/types';
import { buildTranscriptHtml } from '@/modules/chat/export/buildTranscriptHtml';
import { buildTranscriptMarkdown } from '@/modules/chat/export/buildTranscriptMarkdown';

export type TranscriptExportFormat = 'html' | 'markdown' | 'json';

export type TranscriptExportInput = {
  messages: ChatMessage[];
  sessionTitle: string;
  provider: LLMProvider | string;
  selectedProject?: Project | null;
  createDiff: (oldStr: string, newStr: string) => DiffLine[];
  /**
   * Keep BTW asides in the file. Off by default: an aside is not part of the
   * session, so a default export matches what the session itself saw, and the
   * operator opts in from the export menu.
   */
  includeSideQuestions?: boolean;
};

/** True when the export should drop the BTW aside rows and the rows that pair with them. */
function isSideQuestionRow(message: ChatMessage): boolean {
  return Boolean(
    message.btw
    || (typeof message.id === 'string' && /^btw-[qa]-/.test(message.id)),
  );
}

const EXTENSIONS: Record<TranscriptExportFormat, string> = {
  html: 'html',
  markdown: 'md',
  json: 'json',
};

const MIME_TYPES: Record<TranscriptExportFormat, string> = {
  html: 'text/html;charset=utf-8',
  markdown: 'text/markdown;charset=utf-8',
  json: 'application/json;charset=utf-8',
};

/**
 * Makes a session title safe to use as a filename.
 *
 * Session titles are the user's first message, so they routinely contain
 * slashes and quotes; unsanitized they produced downloads named after only the
 * last path segment, or nothing at all.
 */
export function toExportFileStem(sessionTitle: string, exportedAt: Date): string {
  const date = exportedAt.toISOString().slice(0, 10);
  const slug = sessionTitle
    .normalize('NFKD')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .toLowerCase();

  return slug ? `${slug}-${date}` : `conversation-${date}`;
}

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

/** Builds the file's text without downloading it, so it can be asserted on. */
export async function buildTranscriptExport(
  format: TranscriptExportFormat,
  input: TranscriptExportInput,
  exportedAt: Date,
): Promise<string> {
  const messages = input.includeSideQuestions
    ? input.messages
    : input.messages.filter((message) => !isSideQuestionRow(message));

  if (format === 'json') {
    return `${JSON.stringify(
      {
        title: input.sessionTitle,
        provider: input.provider,
        exportedAt: exportedAt.toISOString(),
        messageCount: messages.length,
        messages,
      },
      null,
      2,
    )}\n`;
  }

  if (format === 'markdown') {
    return buildTranscriptMarkdown({
      messages,
      sessionTitle: input.sessionTitle,
      provider: input.provider,
      exportedAt,
      createDiff: input.createDiff,
    });
  }

  return buildTranscriptHtml({
    messages,
    createDiff: input.createDiff,
    provider: input.provider,
    selectedProject: input.selectedProject,
    sessionTitle: input.sessionTitle,
    exportedAt,
  });
}

export async function downloadTranscriptExport(
  format: TranscriptExportFormat,
  input: TranscriptExportInput,
): Promise<void> {
  const exportedAt = new Date();
  const content = await buildTranscriptExport(format, input, exportedAt);
  const filename = `${toExportFileStem(input.sessionTitle, exportedAt)}.${EXTENSIONS[format]}`;

  downloadBlob(new Blob([content], { type: MIME_TYPES[format] }), filename);
}
