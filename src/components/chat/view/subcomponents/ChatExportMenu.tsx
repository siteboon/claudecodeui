import { useState } from 'react';
import { Download, FileJson, FileText } from 'lucide-react';

import type { ChatMessage } from '../../types/types';
import { downloadMarkdown, downloadHTML, downloadPDF, EXPORT_FORMATS } from '../../utils/chatExport';

type ChatExportMenuProps = {
  messages: ChatMessage[];
  sessionTitle?: string;
};

export default function ChatExportMenu({ messages, sessionTitle }: ChatExportMenuProps) {
  const [isOpen, setIsOpen] = useState(false);

  if (messages.length === 0) {
    return null;
  }

  const handleExport = (format: 'markdown' | 'html' | 'pdf') => {
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `${sessionTitle || 'chat'}-${timestamp}`;

    switch (format) {
      case 'markdown':
        downloadMarkdown(messages, `${filename}.md`, sessionTitle);
        break;
      case 'html':
        downloadHTML(messages, `${filename}.html`, sessionTitle);
        break;
      case 'pdf':
        downloadPDF(messages, filename, sessionTitle);
        break;
    }
    setIsOpen(false);
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-label="Export chat"
        title="Export chat"
        className="flex h-8 w-8 items-center justify-center rounded-lg border border-border/50 text-muted-foreground transition-all hover:bg-accent hover:text-foreground"
      >
        <Download className="h-4 w-4" />
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full z-50 mt-2 w-48 rounded-lg border border-border/50 bg-card shadow-lg">
          <div className="p-2">
            <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">Export as:</div>
            {EXPORT_FORMATS.map((fmt) => (
              <button
                key={fmt.id}
                type="button"
                onClick={() => handleExport(fmt.id as 'markdown' | 'html' | 'pdf')}
                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted"
              >
                {fmt.id === 'markdown' ? (
                  <FileText className="h-4 w-4" />
                ) : (
                  <FileJson className="h-4 w-4" />
                )}
                <span>{fmt.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {isOpen && (
        <div className="fixed inset-0" onClick={() => setIsOpen(false)} />
      )}
    </div>
  );
}
