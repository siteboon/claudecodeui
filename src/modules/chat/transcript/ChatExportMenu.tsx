import { useState } from 'react';
import { Download, FileJson, FileText } from 'lucide-react';

import type { ChatMessage, DiffLine } from '@/shared/types';
import { buildTranscriptExport, downloadTranscriptExport, toExportFileStem, downloadPDF, EXPORT_FORMATS } from '@/modules/chat/utils/chatExport';

type ChatExportMenuProps = {
  messages: ChatMessage[];
  sessionTitle?: string;
  provider?: string;
  createDiff: (oldStr: string, newStr: string) => DiffLine[];
};

export default function ChatExportMenu({ messages, sessionTitle, provider, createDiff }: ChatExportMenuProps) {
  const [isOpen, setIsOpen] = useState(false);

  if (messages.length === 0) {
    return null;
  }

  const options = { provider };
  const handleExport = async (format: 'markdown' | 'html' | 'json' | 'pdf') => {
    if (format === 'pdf') {
      const timestamp = new Date().toISOString().split('T')[0];
      const filename = `${sessionTitle || 'chat'}-${timestamp}`;
      downloadPDF(messages, filename, sessionTitle, options);
      setIsOpen(false);
      return;
    }

    const exportedAt = new Date();
    const content = await buildTranscriptExport(format, {
      messages,
      sessionTitle: sessionTitle || 'chat',
      provider: provider || 'claude',
      createDiff,
    }, exportedAt);
    const filename = `${toExportFileStem(sessionTitle || 'chat', exportedAt)}.${format === 'markdown' ? 'md' : format}`;

    const url = URL.createObjectURL(new Blob([content], { type: format === 'json' ? 'application/json;charset=utf-8' : format === 'html' ? 'text/html;charset=utf-8' : 'text/markdown;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
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
                onClick={() => void handleExport(fmt.id as 'markdown' | 'html' | 'pdf')}
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
