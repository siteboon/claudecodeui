import { createElement } from 'react';

import type { ChatMessage, DiffLine, LLMProvider, Project } from '@/shared/types';
import { TranscriptExportDocument } from '@/modules/chat/export/TranscriptExportDocument';

type BuildTranscriptHtmlInput = {
  messages: ChatMessage[];
  createDiff: (oldStr: string, newStr: string) => DiffLine[];
  provider: LLMProvider | string;
  selectedProject?: Project | null;
  sessionTitle: string;
  exportedAt: Date;
};

/**
 * Collects the stylesheets the running app is already using.
 *
 * Reading `document.styleSheets` rather than fetching a build artifact is what
 * makes this work identically in dev (Vite injects `<style>` tags) and in a
 * production build (a single emitted `<link>`), and it means the exported file
 * is styled by definition with the same rules the user was looking at —
 * including every CSS variable the theme is built from.
 */
function collectDocumentStyles(): string {
  const blocks: string[] = [];

  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const rules = sheet.cssRules;
      if (!rules) continue;
      blocks.push(Array.from(rules).map((rule) => rule.cssText).join('\n'));
    } catch {
      // A cross-origin sheet cannot be read. None of the app's own styles are
      // served that way, so skipping it costs nothing.
    }
  }

  return blocks.join('\n');
}

/** Fonts and images are inlined or omitted; a relative URL would 404 offline. */
function dropUnresolvableUrls(css: string): string {
  return css.replace(/url\((["']?)(?!data:|https?:)[^)]*\1\)/g, 'none');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Renders a transcript into one self-contained HTML file.
 *
 * Self-contained is the whole design: no network, no build step, no viewer —
 * it opens offline in any browser, prints to PDF from there, and carries the
 * app's own light and dark themes with a toggle, because a transcript full of
 * syntax-highlighted code is unreadable in the wrong one.
 */
export async function buildTranscriptHtml(input: BuildTranscriptHtmlInput): Promise<string> {
  // Loaded on demand so react-dom/server stays out of the app's main chunk.
  const { renderToStaticMarkup } = await import('react-dom/server');

  const body = renderToStaticMarkup(
    createElement(TranscriptExportDocument, {
      messages: input.messages,
      createDiff: input.createDiff,
      provider: input.provider,
      selectedProject: input.selectedProject,
    }),
  );

  const styles = dropUnresolvableUrls(collectDocumentStyles());
  const title = escapeHtml(input.sessionTitle);
  const isDark = document.documentElement.classList.contains('dark');
  const exportedAt = escapeHtml(input.exportedAt.toLocaleString());
  const messageCount = input.messages.length;

  return `<!DOCTYPE html>
<html lang="en" class="${isDark ? 'dark' : ''}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
${styles}
</style>
<style>
  /* Export-only: the app styles above assume a fixed-height flex shell. */
  html, body { height: auto; overflow: visible; }
  body { background: hsl(var(--background)); color: hsl(var(--foreground)); margin: 0; }
  .chat-export-shell { max-width: 60rem; margin: 0 auto; padding: 2rem 1.25rem 4rem; }
  .chat-export-header {
    display: flex; align-items: center; justify-content: space-between; gap: 1rem;
    border-bottom: 1px solid hsl(var(--border)); padding-bottom: 1rem; margin-bottom: 2rem;
  }
  .chat-export-title { font-size: 1.25rem; font-weight: 600; margin: 0; }
  .chat-export-meta { font-size: 0.75rem; color: hsl(var(--muted-foreground)); margin: 0.25rem 0 0; }
  .chat-export-theme-toggle {
    border: 1px solid hsl(var(--border)); background: transparent; color: inherit;
    border-radius: 0.5rem; padding: 0.375rem 0.75rem; font-size: 0.75rem; cursor: pointer;
  }
  /* Off-screen skipping is a scrolling optimisation; in a printed document it
     leaves blank pages. */
  .chat-message { content-visibility: visible !important; contain-intrinsic-size: auto !important; }
  @media print {
    .chat-export-theme-toggle { display: none; }
    .chat-export-shell { max-width: none; padding: 0; }
  }
</style>
</head>
<body>
<div class="chat-export-shell">
  <header class="chat-export-header">
    <div>
      <h1 class="chat-export-title">${title}</h1>
      <p class="chat-export-meta">${messageCount} messages · exported ${exportedAt}</p>
    </div>
    <button type="button" class="chat-export-theme-toggle" onclick="document.documentElement.classList.toggle('dark')">Toggle theme</button>
  </header>
  ${body}
</div>
</body>
</html>`;
}
