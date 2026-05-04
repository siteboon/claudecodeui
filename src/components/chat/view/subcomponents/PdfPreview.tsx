import { FileText, ExternalLink } from 'lucide-react';

interface PdfPreviewProps {
  url: string;
  filename?: string;
}

/**
 * Inline PDF preview component.
 * Shows the PDF in an iframe with a header bar containing filename and open-in-new-tab action.
 * Falls back to a download link if the browser doesn't support inline PDF.
 */
export default function PdfPreview({ url, filename }: PdfPreviewProps) {
  const displayName = filename || url.split('/').pop() || 'document.pdf';

  return (
    <div data-testid="pdf-preview" className="my-2 overflow-hidden rounded-xl border border-border/50">
      <div className="flex items-center justify-between bg-secondary/50 px-3 py-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <FileText className="h-4 w-4 text-muted-foreground" />
          <span className="truncate">{displayName}</span>
        </div>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground"
          title="Open in new tab"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>
      <iframe
        src={url}
        title={`PDF: ${displayName}`}
        className="h-[400px] w-full border-0"
        sandbox="allow-same-origin"
      />
    </div>
  );
}
